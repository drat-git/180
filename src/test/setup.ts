import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { beforeEach, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
// JSDOM has no layout observer; textarea resizing is covered in browser tests.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// Node 25's experimental localStorage can shadow JSDOM's browser implementation.
vi.stubGlobal(
  "localStorage",
  (globalThis as unknown as { jsdom: { window: { localStorage: Storage } } })
    .jsdom.window.localStorage,
);
afterEach(cleanup);
beforeEach(() => window.localStorage.clear());
