import { beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
import {
  emptyConfiguration,
  getAccountProfile,
  accountProfileKey,
} from "./accountProfile";
import { starterTemplates, starterSelection } from "./starters";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: vi.fn(),
  from: vi.fn(),
  tasks: vi.fn(),
  anti: vi.fn(),
  customization: vi.fn(),
}));
vi.mock("./supabase", () => ({
  supabase: {
    rpc: mock.rpc,
    auth: { getSession: mock.session },
    from: mock.from,
  },
}));
vi.mock("./taskSync", () => ({ pullTasks: mock.tasks }));
vi.mock("./antiSync", () => ({ pullAnti: mock.anti }));
vi.mock("./customizationSync", () => ({
  pullCustomization: mock.customization,
}));
import {
  completeOnboarding,
  cachedAccountProfile,
  fetchAccountProfile,
  onboardingDraftKey,
} from "./accounts";
const wire = (id = "a") => ({
  user_id: id,
  created_at: "2026-10-15T12:00:00Z",
  signup_timezone: "UTC",
  start_date: "2026-10-15",
  legacy: false,
  onboarding_completed_at: "2026-10-15T13:00:00Z",
  starter_id: "blank",
  starter_version: 1,
  initial_configuration: emptyConfiguration(),
});
beforeEach(async () => {
  await db.meta.clear();
  vi.resetAllMocks();
  mock.session.mockResolvedValue({ data: { session: { user: { id: "a" } } } });
  mock.rpc.mockResolvedValue({ data: wire(), error: null });
  mock.tasks.mockResolvedValue(undefined);
  mock.anti.mockResolvedValue(undefined);
  mock.customization.mockResolvedValue(undefined);
});
it("sends only catalog selections and preserves a lost acknowledgement for canonical retry", async () => {
  const selection = starterSelection(starterTemplates[3]);
  await db.meta.put({
    key: onboardingDraftKey("a"),
    value: JSON.stringify(selection),
  });
  mock.tasks.mockRejectedValueOnce(new Error("pull interrupted"));
  await expect(completeOnboarding("a", selection)).rejects.toThrow(
    "pull interrupted",
  );
  expect(await db.meta.get(onboardingDraftKey("a"))).toBeDefined();
  expect(await db.meta.get(accountProfileKey("a"))).toBeUndefined();
  await completeOnboarding("a", selection);
  expect(mock.rpc.mock.calls[1]).toEqual(mock.rpc.mock.calls[0]);
  expect(mock.rpc.mock.calls[0][1]).toEqual({
    p_operation: selection.operationId,
    p_starter: "blank",
    p_version: 1,
    p_selection: { items: [], lists: [], tasks: [], activities: [] },
  });
  expect(await db.meta.get(onboardingDraftKey("a"))).toBeUndefined();
  expect(await cachedAccountProfile("a")).toMatchObject({
    userId: "a",
    legacy: false,
  });
  expect(getAccountProfile("a")?.initialConfiguration).toEqual(
    emptyConfiguration(),
  );
});
it("rejects wrong sessions and never registers a foreign profile response", async () => {
  await expect(
    completeOnboarding("b", starterSelection(starterTemplates[0])),
  ).rejects.toThrow("Sign in again");
  expect(mock.rpc).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValue({ data: wire("b"), error: null });
  await expect(
    completeOnboarding("a", starterSelection(starterTemplates[0])),
  ).rejects.toThrow("could not be confirmed");
  expect(getAccountProfile("b")).toBeUndefined();
});
it("loads an authenticated profile before normal rendering and ignores invalid account caches", async () => {
  const single = vi.fn().mockResolvedValue({ data: wire(), error: null });
  mock.from.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) });
  await fetchAccountProfile("a");
  expect(getAccountProfile("a")?.startDate).toBe("2026-10-15");
  await db.meta.put({
    key: accountProfileKey("b"),
    value: (await db.meta.get(accountProfileKey("a")))!.value,
  });
  expect(await cachedAccountProfile("b")).toBeUndefined();
});
