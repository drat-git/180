import { db, type AppDatabase } from "./db";
import {
  createId,
  emptyData,
  type DailyEntry,
  type Task,
  type TaskEvent,
  type TaskSelection,
  type TaskTopic,
  type TaskOptions,
  type AntiItem,
  type AntiLog,
  type AntiEvent,
} from "./model";
import { applyTaskCommand } from "./tasks";
import { applyAntiCommand } from "./antiRotting";
import {
  DEMO_PREFIX,
  DEMO_SESSION_KEY,
  demoLogicalDate,
  isDemoUser,
} from "./appMode";

const SEED_VERSION = "1";
export function demoSession(): string {
  const current = sessionStorage.getItem(DEMO_SESSION_KEY);
  if (current && isDemoUser(current)) return current;
  const userId = DEMO_PREFIX + createId();
  sessionStorage.setItem(DEMO_SESSION_KEY, userId);
  return userId;
}

export function createDemoSeed(userId: string) {
  if (!isDemoUser(userId))
    throw new Error("Demo samples require a demo identity.");
  const id = (key: string) => `${userId}:${key}`;
  let tasks: Task[] = [];
  const taskEvents: TaskEvent[] = [];
  function task(
    key: string,
    topic: TaskTopic,
    title: string,
    at: string,
    parent?: string,
    options: TaskOptions = {},
  ) {
    const result = applyTaskCommand(tasks, userId, id(`create:${key}`), {
      taskId: id(key),
      action: "create",
      ...options,
      topic,
      title,
      parentId: parent ? id(parent) : null,
      at,
      logicalDate: demoLogicalDate(new Date(at)),
      timezone: "America/New_York",
    });
    tasks = result.tasks;
  }
  function complete(key: string, at: string) {
    const result = applyTaskCommand(tasks, userId, id(`complete:${key}`), {
      taskId: id(key),
      action: "complete",
      completed: true,
      at,
      logicalDate: demoLogicalDate(new Date(at)),
      timezone: "America/New_York",
    });
    tasks = result.tasks;
    taskEvents.push(...result.events);
  }
  const sunday = "2026-10-11T10:00:00-04:00";
  const monday = "2026-10-12T09:00:00-04:00";
  task("resume", "career", "Tailor resume for a software internship", sunday);
  task(
    "interview",
    "career",
    "Practice common interview questions",
    sunday,
    undefined,
    { highPriority: true, estimatedMinutes: 45 },
  );
  task("project", "career", "Build a campus events project", sunday);
  for (const [key, title] of [
    ["screens", "Sketch main screens"],
    ["event-list", "Build the event list"],
    ["search", "Add search and filters"],
    ["setup", "Write setup notes"],
  ])
    task(key, "career", title, sunday, "project");
  task("linkedin", "career", "Refresh LinkedIn profile", sunday);
  complete("linkedin", "2026-10-11T15:00:00-04:00");
  complete("screens", "2026-10-11T16:00:00-04:00");
  complete("event-list", "2026-10-11T17:30:00-04:00");
  task("biology", "school", "Review biology lecture notes", monday);
  task("sociology", "school", "Read Chapter 4 for sociology", monday);
  task("essay", "school", "Prepare history essay", monday, undefined, {
    highPriority: true,
  });
  task("topic", "school", "Choose a topic", monday, "essay");
  task("outline", "school", "Draft an outline", monday, "essay", {
    estimatedMinutes: 20,
  });
  task("draft", "school", "Write the first draft", monday, "essay");
  task("statistics", "school", "Finish statistics practice set", monday);
  complete("statistics", "2026-10-12T15:00:00-04:00");
  complete("topic", "2026-10-12T16:00:00-04:00");
  complete("search", "2026-10-12T22:00:00-04:00");
  complete("setup", "2026-10-12T23:30:00-04:00");
  task("laundry", "life", "Do laundry", sunday);
  task("groceries", "life", "Pick up groceries", sunday);
  task("haircut", "life", "Book a haircut", sunday);
  task("library", "life", "Return library books", sunday);
  complete("library", "2026-10-12T21:15:00-04:00");

  const selection = (key: string, children: string[] = []): TaskSelection => ({
    taskId: id(key),
    title: tasks.find((t) => t.id === id(key))!.title,
    children: children.map((child) => ({
      taskId: id(child),
      title: tasks.find((t) => t.id === id(child))!.title,
    })),
  });
  const day1 = {
    ...emptyData(),
    wakeTime: "07:45",
    screenTimeMinutes: 140,
    cannabisStatus: false,
    applicationsStatus: true,
    applicationsCount: 2,
    careerTasksStatus: true,
    careerTasksWorkedOn: [
      selection("linkedin"),
      selection("project", ["screens", "event-list"]),
    ],
    amBreakfast: { status: true, choice: "meal" as const },
    amBreakfastDescription: "Eggs and toast",
    meal1Status: true,
    meal1Description: "Rice bowl with chicken and vegetables",
    meal2Status: true,
    meal2Description: "Pasta and a side salad with a friend",
    shakeStatus: true,
    snackStatus: true,
    snackDescription: "An apple and a protein bar",
    liftedStatus: false,
    liftedReason: "Took a rest day and walked instead.",
    pmPostureStatus: true,
    creatineStatus: true,
    journalText:
      "Went for a walk, made breakfast, and spent part of the afternoon updating my LinkedIn profile and working on the campus events project. Sent two internship applications, read for fun, and had dinner with a friend. A steady Sunday before classes start again.",
  };
  const day2 = {
    ...emptyData(),
    wakeTime: "08:55",
    wakeReason: "Snoozed my alarm after staying up talking with a friend.",
    screenTimeMinutes: 252,
    screenTimeReason:
      "Kept checking feeds between classes and while waiting for replies.",
    cannabisStatus: true,
    cannabisCount: 1,
    cannabisUseDescriptions: ["Once while winding down after project work."],
    classAttendanceStatus: true,
    schoolTasksStatus: true,
    schoolTasksWorkedOn: [
      selection("statistics"),
      selection("essay", ["topic"]),
    ],
    applicationsStatus: true,
    applicationsCount: 4,
    careerTasksStatus: true,
    careerTasksWorkedOn: [selection("project", ["search", "setup"])],
    amBreakfast: { status: true, choice: "shake" as const },
    meal1Status: true,
    meal1Description: "A sandwich and fruit between classes",
    meal2Status: true,
    meal2Description: "Tofu stir-fry with rice",
    shakeStatus: false,
    shakeReason: "Forgot to take it after exercising.",
    snackStatus: true,
    snackDescription: "Yogurt and granola",
    liftedStatus: true,
    pmPostureStatus: false,
    pmPostureReason: "Spent most of the day in class and at my desk.",
    creatineStatus: true,
    journalText:
      "Made it to both classes, finished a statistics practice set, and picked a topic for my history essay. Sent four internship applications and finished the campus events project after dinner. Watched a short space lecture, but still went over my screen-time goal and stayed up later than planned.",
  };
  const days: [string, DailyEntry["data"]][] = [
    ["2026-10-11", day1],
    ["2026-10-12", day2],
    ["2026-10-13", emptyData()],
  ];
  const entries: DailyEntry[] = days.map(([date, data]) => ({
    userId,
    logicalDate: date,
    data,
    revision: 0,
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
  }));

  let anti: { items: AntiItem[]; logs: AntiLog[]; events: AntiEvent[] } = {
    items: [],
    logs: [],
    events: [],
  };
  for (const [key, title, notes, itemType] of [
    [
      "walk",
      "Take a walk without headphones",
      "Notice a few things along the way.",
      "reusable",
    ],
    [
      "reading",
      "Read for pleasure",
      "A chapter of something unrelated to class.",
      "reusable",
    ],
    [
      "guitar",
      "Practice guitar for 15 minutes",
      "Work on a song or a chord change.",
      "reusable",
    ],
    [
      "sketch",
      "Sketch something nearby",
      "A mug, a plant, or the view from a window.",
      "reusable",
    ],
    [
      "lecture",
      "Watch a public lecture about space",
      "Pick a short lecture and jot down one thing you learned.",
      "one-time",
    ],
    [
      "exhibit",
      "Visit the campus art exhibit",
      "Stop by between classes this week.",
      "one-time",
    ],
  ] as const) {
    anti = applyAntiCommand(anti, userId, id(`anti-create:${key}`), {
      itemId: id(key),
      action: "create",
      title,
      notes,
      itemType,
      at: sunday,
      logicalDate: "2026-10-11",
      timezone: "America/New_York",
    });
  }
  for (const [key, at] of [
    ["walk", "2026-10-11T11:00:00-04:00"],
    ["reading", "2026-10-11T20:00:00-04:00"],
    ["guitar", "2026-10-12T18:00:00-04:00"],
    ["lecture", "2026-10-12T23:10:00-04:00"],
  ]) {
    anti = applyAntiCommand(anti, userId, id(`anti-log:${key}`), {
      itemId: id(key),
      action: key === "lecture" ? "complete" : "log",
      logged: true,
      completed: true,
      at,
      logicalDate: demoLogicalDate(new Date(at)),
      timezone: "America/New_York",
    });
  }
  return { entries, tasks, taskEvents, ...anti };
}

export async function seedDemo(
  userId: string,
  reset = false,
  database: AppDatabase = db,
) {
  if (!isDemoUser(userId))
    throw new Error("Cannot reset a private account as a demo.");
  const marker = `demo-seed:${userId}`;
  const tables = [
    database.entries,
    database.tasks,
    database.taskEvents,
    database.antiItems,
    database.antiLogs,
    database.antiEvents,
    database.images,
    database.blobs,
    database.outbox,
  ];
  await database.transaction("rw", [...tables, database.meta], async () => {
    if (!reset && (await database.meta.get(marker))?.value === SEED_VERSION)
      return;
    for (const table of tables)
      await table.where("userId").equals(userId).delete();
    const seed = createDemoSeed(userId);
    await database.entries.bulkPut(seed.entries);
    await database.tasks.bulkPut(seed.tasks);
    await database.taskEvents.bulkPut(seed.taskEvents);
    await database.antiItems.bulkPut(seed.items);
    await database.antiLogs.bulkPut(seed.logs);
    await database.antiEvents.bulkPut(seed.events);
    await database.meta.put({ key: marker, value: SEED_VERSION });
  });
}

export function clearDemoDisplayPreferences(userId: string) {
  const prefix = `180:display:${encodeURIComponent(userId)}:`;
  for (const key of Object.keys(localStorage))
    if (key.startsWith(prefix)) localStorage.removeItem(key);
  window.dispatchEvent(new Event("180-display-change"));
}
