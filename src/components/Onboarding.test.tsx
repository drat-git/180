import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../lib/db";
import { legacyAccountProfile } from "../lib/accountProfile";
const complete = vi.hoisted(() => vi.fn());
vi.mock("../lib/accounts", () => ({
  completeOnboarding: complete,
  onboardingDraftKey: (id: string) => `onboarding-draft:${id}`,
}));
import { Onboarding } from "./Onboarding";
const done = vi.fn();
const open = (id = "onboarding-user") =>
  render(<Onboarding userId={id} onComplete={done} onSignOut={vi.fn()} />);
beforeEach(async () => {
  await db.meta.clear();
  complete.mockReset();
  done.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
it("preserves dependencies, Back and reload choices, and uses the same operation on a failed retry", async () => {
  const user = userEvent.setup();
  let view = open();
  await user.click(await screen.findByRole("button", { name: /Student/ }));
  const list = screen.getByRole("checkbox", { name: "Keep School list" });
  await user.click(list);
  expect(
    screen.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Review your next assignment" }),
  ).toBeDisabled();
  await user.click(list);
  expect(
    screen.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: /Back to starters/ }));
  await user.click(screen.getByRole("button", { name: /Student/ }));
  expect(
    screen.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).not.toBeChecked();
  await waitFor(async () =>
    expect(
      JSON.parse((await db.meta.get("onboarding-draft:onboarding-user"))!.value)
        .step,
    ).toBe("review"),
  );
  view.unmount();
  view = open();
  expect(
    await screen.findByRole("heading", { name: "Make it yours." }),
  ).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: /Worked on School tasks/ }),
  ).not.toBeChecked();
  complete.mockRejectedValueOnce(new Error("Connection interrupted"));
  await user.click(screen.getByRole("button", { name: "Start using 180" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Connection interrupted",
  );
  const first = complete.mock.calls[0][1];
  complete.mockResolvedValueOnce(legacyAccountProfile("onboarding-user"));
  await user.click(screen.getByRole("button", { name: "Start using 180" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(complete.mock.calls[1][1]).toEqual(first);
  expect(first.items).toHaveLength(5);
  expect(first.tasks).toHaveLength(1);
});
it("switches to another starter's defaults, supports blank setup, and keeps drafts account scoped", async () => {
  const user = userEvent.setup();
  const view = open("first");
  await user.click(await screen.findByRole("button", { name: /Everyday/ }));
  await user.click(screen.getByRole("checkbox", { name: /Moved my body/ }));
  await user.click(screen.getByRole("button", { name: /Back to starters/ }));
  await user.click(screen.getByRole("button", { name: /Work & projects/ }));
  expect(screen.getByRole("checkbox", { name: /Moved my body/ })).toBeChecked();
  await user.click(screen.getByRole("button", { name: /Back to starters/ }));
  await user.click(screen.getByRole("button", { name: /Start from scratch/ }));
  expect(screen.getByRole("heading", { name: "A clean slate." })).toBeVisible();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  await waitFor(async () =>
    expect(
      JSON.parse((await db.meta.get("onboarding-draft:first"))!.value).selection
        .starterId,
    ).toBe("blank"),
  );
  view.unmount();
  open("second");
  expect(await screen.findByRole("button", { name: /Everyday/ })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "A clean slate." }),
  ).not.toBeInTheDocument();
});
it("allows reviewing offline but requires a connection to finish", async () => {
  const user = userEvent.setup();
  open();
  await user.click(await screen.findByRole("button", { name: /Everyday/ }));
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  fireEvent(window, new Event("offline"));
  expect(
    screen.getByRole("button", { name: "Start using 180" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Moved my body/ }));
  expect(
    screen.getByRole("checkbox", { name: /Moved my body/ }),
  ).not.toBeChecked();
  expect(complete).not.toHaveBeenCalled();
});
