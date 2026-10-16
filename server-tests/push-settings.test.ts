import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  keys: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../supabase/functions/_shared/backend.ts", () => ({
  admin: { from: mock.from, auth: { getUser: mock.getUser } },
  credentials: mock.keys,
  sendPush: mock.send,
  failureStatus: () => 500,
}));
vi.stubGlobal("Deno", { serve: vi.fn() });
const { handlePushSettings } =
  await import("../supabase/functions/push-settings/index.ts");
const user = "80000000-0000-4000-8000-000000000001",
  foreign = "80000000-0000-4000-8000-000000000002",
  installation = "90000000-0000-4000-8000-000000000001";
let rows: Record<string, unknown>[];
let ready: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  ready = true;
  rows = [
    {
      id: installation,
      user_id: foreign,
      enabled: true,
      endpoint: "https://web.push.apple.com/foreign",
    },
  ];
  mock.getUser.mockResolvedValue({ data: { user: { id: user } }, error: null });
  mock.keys.mockResolvedValue({ publicKey: "A".repeat(87) });
  mock.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    let mutation: "insert" | "update" | undefined,
      values: Record<string, unknown>;
    const result = () => {
      if (table === "account_profiles")
        return {
          data: ready
            ? { user_id: user, onboarding_completed_at: "now" }
            : null,
          error: null,
        };
      if (mutation === "insert") {
        if (rows.some((row) => row.id === values.id))
          return { data: null, error: new Error("ID collision") };
        rows.push({ ...values });
        return { data: values, error: null };
      }
      const found = rows.find((row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value),
      );
      if (mutation === "update" && found) Object.assign(found, values);
      return { data: found ?? null, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return builder;
      },
      maybeSingle: async () => result(),
      single: async () => result(),
      insert: (value: Record<string, unknown>) => {
        values = value;
        mutation = "insert";
        return builder;
      },
      update: (value: Record<string, unknown>) => {
        values = value;
        mutation = "update";
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return builder;
  });
});
const request = (action: string, id = installation) =>
  new Request("https://example.invalid/push-settings", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-only",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      installationId: id,
      time: "21:00",
      timezone: "America/New_York",
      origin: "https://180-vlfh.vercel.app",
      subscription: {
        endpoint: "https://web.push.apple.com/own",
        keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
      },
    }),
  });
it("rejects a foreign installation ID collision rather than upserting another account's subscription", async () => {
  const before = structuredClone(rows);
  const response = await handlePushSettings(request("subscribe"));
  expect(response.status).toBe(500);
  expect(rows).toEqual(before);
});
it("does not expose or disable foreign reminders and can create a separate installation", async () => {
  const response = await handlePushSettings(request("unsubscribe"));
  expect(response.status).toBe(200);
  expect((await response.json()).enabled).toBe(false);
  expect(rows[0].enabled).toBe(true);
  const own = "90000000-0000-4000-8000-000000000002";
  expect((await handlePushSettings(request("subscribe", own))).status).toBe(
    200,
  );
  expect(rows.find((row) => row.id === own)?.user_id).toBe(user);
});
it("requires a completed profile and verifies the session before reading settings", async () => {
  ready = false;
  expect((await handlePushSettings(request("config"))).status).toBe(403);
  expect(mock.keys).not.toHaveBeenCalled();
  mock.getUser.mockResolvedValue({
    data: { user: null },
    error: new Error("expired"),
  });
  mock.from.mockClear();
  expect((await handlePushSettings(request("config"))).status).toBe(401);
  expect(mock.from).not.toHaveBeenCalled();
});
