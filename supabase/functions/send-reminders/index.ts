import {
  admin,
  credentials,
  sendPush,
  failureStatus,
} from "../_shared/backend.ts";
import { reminderDay, nextReminder } from "../_shared/schedule.ts";
Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  try {
    const keys = await credentials(true);
    if (req.headers.get("X-Reminder-Token") !== keys.dispatchToken)
      return new Response("Unauthorized", { status: 401 });
    const now = new Date();
    const { data: rows, error } = await admin
      .from("push_installations")
      .select("*")
      .eq("enabled", true)
      .lte("next_send_at", now.toISOString())
      .limit(100);
    if (error) throw error;
    let sent = 0;
    for (const row of rows ?? []) {
      // The scheduled occurrence, not dispatch delay, identifies its logical day.
      const scheduled = new Date(row.next_send_at);
      const day = reminderDay(scheduled, row.timezone);
      const expires = nextReminder(scheduled, "02:00", row.timezone);
      const { data: claimed, error: claimError } = await admin.rpc(
        "claim_push_delivery",
        { p_installation: row.id, p_day: day, p_expires: expires },
      );
      if (claimError) throw claimError;
      if (claimed) {
        let status = "sent";
        try {
          await sendPush(
            row,
            `180-checklist:${row.id}:${day}`,
            Math.max(
              1,
              Math.floor((Date.parse(expires) - now.getTime()) / 1000),
            ),
            keys,
          );
          sent++;
        } catch (e) {
          const code = failureStatus(e);
          if ([404, 410].includes(code)) {
            await admin
              .from("push_installations")
              .update({ enabled: false })
              .eq("id", row.id);
            status = "expired";
          } else status = code === 429 || code >= 500 ? "pending" : "failed";
        }
        const done = await admin
          .from("push_deliveries")
          .update({
            status,
            lease_until: new Date(now.getTime() + 120000).toISOString(),
          })
          .eq("installation_id", row.id)
          .eq("logical_date", day);
        if (done.error) throw done.error;
      }
      const { data: delivery, error: deliveryError } = await admin
        .from("push_deliveries")
        .select("status,attempts")
        .eq("installation_id", row.id)
        .eq("logical_date", day)
        .maybeSingle();
      if (deliveryError) throw deliveryError;
      if (
        Date.parse(expires) <= now.getTime() ||
        (delivery && (delivery.status !== "pending" || delivery.attempts >= 3))
      ) {
        const next = await admin
          .from("push_installations")
          .update({
            next_send_at: nextReminder(now, row.reminder_time, row.timezone),
          })
          .eq("id", row.id)
          .eq("next_send_at", row.next_send_at);
        if (next.error) throw next.error;
      }
    }
    console.log(JSON.stringify({ checked: rows?.length ?? 0, sent }));
    return Response.json({ checked: rows?.length ?? 0, sent });
  } catch {
    console.error("Reminder dispatch failed");
    return Response.json(
      { error: "Reminder dispatch failed" },
      { status: 500 },
    );
  }
});
