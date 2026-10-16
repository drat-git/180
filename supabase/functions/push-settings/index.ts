import {
  admin,
  credentials,
  sendPush,
  failureStatus,
} from "../_shared/backend.ts";
import {
  nextReminder,
  validateTime,
  validEndpoint,
} from "../_shared/schedule.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
export async function handlePushSettings(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST")
    return reply({ error: "Method not allowed." }, 405);
  // Custom authentication supports current Supabase signing keys; never trust a decoded JWT alone.
  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) return reply({ error: "Sign in to manage reminders." }, 401);
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user)
    return reply({ error: "Sign in again to manage reminders." }, 401);
  const { data: account } = await admin
    .from("account_profiles")
    .select("user_id,onboarding_completed_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account?.onboarding_completed_at)
    return reply({ error: "Finish account setup to manage reminders." }, 403);
  try {
    const body = await req.json();
    const id = body.installationId;
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return reply({ error: "Invalid app installation." }, 400);
    const { data: existing, error: readError } = await admin
      .from("push_installations")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw readError;
    const keys = await credentials(true);
    let row = existing;
    const now = new Date();
    if (body.action === "subscribe" || body.action === "update") {
      validateTime(body.time, body.timezone);
      const values: Record<string, unknown> = {
        reminder_time: body.time,
        timezone: body.timezone,
        next_send_at: nextReminder(now, body.time, body.timezone),
        updated_at: now.toISOString(),
      };
      if (body.action === "subscribe") {
        const sub = body.subscription;
        if (
          !sub ||
          !validEndpoint(sub.endpoint) ||
          !/^[A-Za-z0-9_-]{86,88}$/.test(sub.keys?.p256dh ?? "") ||
          !/^[A-Za-z0-9_-]{22,24}$/.test(sub.keys?.auth ?? "")
        )
          return reply({ error: "Invalid push subscription." }, 400);
        const origin = new URL(body.origin);
        if (
          origin.protocol !== "https:" ||
          origin.origin !== body.origin ||
          origin.username ||
          origin.password ||
          origin.hostname === "localhost" ||
          /^[\d.]+$/.test(origin.hostname)
        )
          return reply(
            { error: "Enable reminders from your HTTPS installed app." },
            400,
          );
        const prior = await admin
          .from("push_installations")
          .select("id")
          .eq("endpoint", sub.endpoint)
          .eq("user_id", user.id)
          .maybeSingle();
        if (prior.error) throw prior.error;
        Object.assign(values, {
          id: prior.data?.id ?? id,
          user_id: user.id,
          origin: origin.origin,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          enabled: true,
        });
        // An insert must fail on a foreign ID collision. Upsert by primary key
        // would allow a caller to replace another account's installation.
        const targetId = prior.data?.id ?? id;
        const ownExisting = prior.data || existing;
        const write = ownExisting
          ? admin
              .from("push_installations")
              .update(values)
              .eq("id", targetId)
              .eq("user_id", user.id)
          : admin.from("push_installations").insert(values);
        const result = await write.select().single();
        if (result.error) throw result.error;
        row = result.data;
      } else {
        if (!existing) return reply({ error: "Enable reminders first." }, 400);
        const result = await admin
          .from("push_installations")
          .update(values)
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single();
        if (result.error) throw result.error;
        row = result.data;
      }
    } else if (body.action === "unsubscribe") {
      if (existing) {
        const result = await admin
          .from("push_installations")
          .update({ enabled: false, updated_at: now.toISOString() })
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single();
        if (result.error) throw result.error;
        row = result.data;
      }
    } else if (body.action === "test") {
      if (!existing?.enabled)
        return reply({ error: "Enable reminders first." }, 400);
      // Atomically rate-limit test pushes to one per minute for this installation.
      const result = await admin
        .from("push_installations")
        .update({ last_test_at: now.toISOString() })
        .eq("id", id)
        .eq("user_id", user.id)
        .or(
          `last_test_at.is.null,last_test_at.lt.${new Date(now.getTime() - 60000).toISOString()}`,
        )
        .select()
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data)
        return reply(
          { error: "Wait a minute before sending another test." },
          429,
        );
      try {
        await sendPush(existing, `180-test:${id}`, 300, keys);
      } catch (e) {
        if ([404, 410].includes(failureStatus(e)))
          await admin
            .from("push_installations")
            .update({ enabled: false })
            .eq("id", id);
        return reply(
          {
            error:
              "Couldn’t deliver the test. Try disabling and re-enabling reminders.",
          },
          502,
        );
      }
    } else if (body.action !== "config")
      return reply({ error: "Unknown action." }, 400);
    return reply({
      enabled: !!row?.enabled,
      time: row?.reminder_time ?? "21:00",
      timezone: row?.timezone ?? "America/New_York",
      publicKey: keys.publicKey,
      installationId: row?.id ?? id,
    });
  } catch (e) {
    const validation =
      e instanceof RangeError ||
      e instanceof TypeError ||
      (e instanceof Error && e.message === "Choose a valid reminder time.");
    return reply(
      {
        error: validation
          ? "Choose a valid reminder time and timezone."
          : "Couldn’t save reminder settings. Try again.",
      },
      validation ? 400 : 500,
    );
  }
}
Deno.serve(handlePushSettings);
