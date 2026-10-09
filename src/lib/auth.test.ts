import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
const mock = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: unknown) => void),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof mock.callback) => {
        mock.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: mock.getSession,
      signOut: mock.signOut,
    },
  },
}));
import { useAuth } from "./auth";
beforeEach(async () => {
  await db.meta.clear();
  vi.clearAllMocks();
  await db.meta.put({
    key: "active-account",
    value: JSON.stringify({ id: "owner", email: "owner@example.com" }),
  });
  mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mock.signOut.mockImplementation(async () =>
    mock.callback?.("SIGNED_OUT", null),
  );
});
it("retains local access when authentication renewal signs the cloud session out", async () => {
  const { result } = renderHook(useAuth);
  await waitFor(() => expect(result.current.user?.id).toBe("owner"));
  await act(async () => mock.callback?.("SIGNED_OUT", null));
  await waitFor(() => expect(result.current.user?.cached).toBe(true));
  expect(await db.meta.get("active-account")).toBeDefined();
});
it("explicit sign-out removes the local unlock and locks the app", async () => {
  const { result } = renderHook(useAuth);
  await waitFor(() => expect(result.current.user?.id).toBe("owner"));
  await act(async () => result.current.signOut());
  await waitFor(() => expect(result.current.user).toBeNull());
  expect(await db.meta.get("active-account")).toBeUndefined();
});
