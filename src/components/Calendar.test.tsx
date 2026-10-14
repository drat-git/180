import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Calendar } from "./Calendar";
import { db } from "../lib/db";
import { seedDemo } from "../lib/demo";
import { DEMO_MODE, DEMO_TODAY } from "../lib/appMode";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((table) => table.clear()));
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
