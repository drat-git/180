import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { beforeEach, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
// Node 25's experimental localStorage can shadow JSDOM's browser implementation.
vi.stubGlobal(
  "localStorage",
  (globalThis as unknown as { jsdom: { window: { localStorage: Storage } } })
    .jsdom.window.localStorage,
);
afterEach(cleanup);
beforeEach(() => window.localStorage.clear());
