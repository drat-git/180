import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import webpush from "npm:web-push@3.6.7";
export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
export async function credentials(initialize = false) {
  const keys = initialize ? webpush.generateVAPIDKeys() : null;
  const { data, error } = await admin.rpc("push_backend_config", {
    p_public: keys?.publicKey ?? null,
    p_private: keys?.privateKey ?? null,
  });
  if (error) throw new Error("Reminder configuration unavailable.");
  return data as {
    publicKey: string;
    privateKey: string;
    dispatchToken: string;
  };
}
export async function sendPush(
  row: { endpoint: string; p256dh: string; auth: string },
  tag: string,
  ttl: number,
  keys: Awaited<ReturnType<typeof credentials>>,
) {
  return await webpush.sendNotification(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    JSON.stringify({ tag }),
    {
      vapidDetails: {
        subject: Deno.env.get("SUPABASE_URL")!,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      },
      TTL: ttl,
      timeout: 10000,
      urgency: "normal",
    },
  );
}
export function failureStatus(error: unknown) {
  return Number((error as { statusCode?: number })?.statusCode) || 503;
}
