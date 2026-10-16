import { beforeEach as registerLegacyBeforeEach } from "vitest";
import {
  registerAccountProfile,
  legacyAccountProfile,
} from "../lib/accountProfile";
registerLegacyBeforeEach(() => {
  registerAccountProfile(legacyAccountProfile("calendar-private-owner"));
});
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Calendar } from "./Calendar";
import { db } from "../lib/db";
import { seedDemo } from "../lib/demo";
import { DEMO_MODE, DEMO_TODAY, PRIVATE_MODE } from "../lib/appMode";
import { emptyData, type DailyEntry, type Task } from "../lib/model";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
});

it("reacts to private cached records and clock changes without queuing cloud writes", async () => {
  const userId = "calendar-private-owner";
  const entry: DailyEntry = {
    userId,
    logicalDate: "2026-10-14",
    data: emptyData(),
    revision: 1,
    createdAt: "2026-10-14T12:00:00Z",
    updatedAt: "2026-10-14T12:00:00Z",
  };
  await db.entries.put(entry);
  const view = render(
    <Calendar
      userId={userId}
      today={entry.logicalDate}
      mode={PRIVATE_MODE}
      onOpenDay={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Calendar checklist progress"),
    ).toHaveTextContent("0 of 14 checks complete"),
  );
  await db.entries.put({
    ...entry,
    revision: 2,
    data: {
      ...entry.data,
      wakeTime: "09:10",
      cannabisStatus: true,
      cannabisCount: 2,
    },
  });
  await waitFor(() =>
    expect(
      screen.getByLabelText("Calendar checklist progress"),
    ).toHaveTextContent("2 of 14 checks complete"),
  );
  view.rerender(
    <Calendar
      userId={userId}
      today="2026-10-13"
      mode={PRIVATE_MODE}
      onOpenDay={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("button", { name: /^Wednesday, October 14, 2026,/ }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: /^Tuesday, October 13, 2026,/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await db.outbox.count()).toBe(0);
});

it("shows a retryable read error rather than false zero scores and recovers without writing", async () => {
  const userId = "local-demo:calendar-read-error";
  await seedDemo(userId);
  const before = await db.entries.toArray();
  const read = vi
    .spyOn(db, "transaction")
    .mockRejectedValueOnce(new Error("Unavailable disk"));
  render(
    <Calendar
      userId={userId}
      today={DEMO_TODAY}
      mode={DEMO_MODE}
      onOpenDay={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load your calendar.",
  );
  expect(
    screen.queryByRole("region", { name: "Day preview" }),
  ).not.toBeInTheDocument();
  read.mockRestore();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry loading calendar" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Day preview" }),
    ).toHaveTextContent("No entries recorded"),
  );
  expect(await db.entries.toArray()).toEqual(before);
});

it("updates future markers and previews as deadlines change without creating daily entries", async () => {
  const userId = "local-demo:calendar-deadlines";
  const task: Task = {
    id: "essay",
    userId,
    title: "Write essay",
    topic: "school",
    parentId: null,
    completedAt: null,
    deletedAt: null,
    revision: 1,
    createdAt: "2026-10-13T12:00:00Z",
    updatedAt: "2026-10-13T12:00:00Z",
    deadline: { date: "2026-11-03" },
    highPriority: true,
    estimatedMinutes: 90,
  };
  await db.tasks.put(task);
  const onOpenDay = vi.fn();
  render(
    <Calendar
      userId={userId}
      today={DEMO_TODAY}
      mode={DEMO_MODE}
      onOpenDay={onOpenDay}
    />,
  );
  const next = await screen.findByRole("button", { name: "Next month" });
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  const marker = screen.getByRole("button", {
    name: /^Tuesday, November 3, 2026, 1 task due/,
  });
  expect(marker).toBeEnabled();
  expect(screen.getByRole("region", { name: "Day preview" })).toHaveTextContent(
    "School to-do",
  );
  expect(screen.getByRole("region", { name: "Day preview" })).toHaveTextContent(
    "Est. 1 hr 30 min",
  );
  expect(screen.getByRole("img", { name: "High priority" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open day" }),
  ).not.toBeInTheDocument();
  await db.tasks.update(task.id, { deadline: { date: "2026-11-04" } });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: /^Tuesday, November 3, 2026, 1 task due/,
      }),
    ).not.toBeInTheDocument(),
  );
  // An edited deadline moves its marker and returns the stale selection to Today.
  expect(
    screen.getByRole("button", { name: /^Tuesday, October 13, 2026,/ }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(next);
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: "Day preview" }),
    ).toHaveTextContent("Write essay"),
  );
  await db.tasks.update(task.id, { completedAt: "2026-10-13T13:00:00Z" });
  // Next month is already disabled while viewing the last future month; wait
  // for the live deadline read to remove the preview before checking controls.
  await waitFor(() =>
    expect(screen.queryByText("UPCOMING DEADLINES")).not.toBeInTheDocument(),
  );
  expect(next).toBeDisabled();
  expect(onOpenDay).not.toHaveBeenCalled();
  expect(await db.entries.count()).toBe(0);
  expect(await db.taskEvents.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});
