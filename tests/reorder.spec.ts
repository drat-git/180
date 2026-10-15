import { expect, test, type Locator, type Page } from "@playwright/test";

async function openEditor(page: Page, lists = false) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try the demo mode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page
    .getByRole("button", {
      name: lists ? "Manage To-do lists" : "Customize checklist",
      exact: true,
    })
    .click();
  return page.getByRole("dialog", {
    name: lists ? "Manage To-do lists" : "Customize checklist",
    exact: true,
  });
}

async function pressHandle(page: Page, handle: Locator, touch: boolean) {
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    return {
      move: async (targetY: number) => {
        for (let step = 1; step <= 8; step++)
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y + ((targetY - y) * step) / 8 }],
          });
      },
      end: async (cancelled = false) => {
        await session.send("Input.dispatchTouchEvent", {
          type: cancelled ? "touchCancel" : "touchEnd",
          touchPoints: [],
        });
        await session.detach();
      },
    };
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  return {
    move: async (targetY: number) => {
      await page.mouse.move(x, targetY, { steps: 8 });
    },
    end: async (cancelled = false) => {
      if (cancelled) await page.keyboard.press("Escape");
      await page.mouse.up();
    },
  };
}

test("hold handles reorder collapsed items, highlight the moving card, and cancel safely", async ({
  page,
  isMobile,
}, info) => {
  const editor = await openEditor(page);
  await editor.getByRole("button", { name: "Add block", exact: true }).click();
  const block = editor.getByRole("region", {
    name: "Edit New block",
    exact: true,
  });
  await block
    .getByRole("textbox", { name: "Block title", exact: true })
    .fill("Practice");
  const practice = editor.getByRole("region", {
    name: "Edit Practice",
    exact: true,
  });
  for (const name of ["Read", "Write"]) {
    await practice
      .getByRole("button", { name: "Add item to Practice", exact: true })
      .click();
    const item = practice.locator("[data-reorder-card=item]").last();
    await item.locator(":scope > summary").click();
    await item
      .getByRole("textbox", { name: "Item label", exact: true })
      .fill(name);
    await item.locator(":scope > summary").click();
  }
  const items = practice.locator("[data-reorder-card=item]");
  const titles = items.locator(":scope > summary > span:first-child");
  const write = practice.getByRole("button", {
    name: "Reorder Write",
    exact: true,
  });
  await write.click();
  await expect(titles).toHaveText([/Read/, /Write/]);
  await expect(items.locator(":scope[open]")).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: /^Move .+ (up|down)$/ }),
  ).toHaveCount(0);

  const drag = await pressHandle(page, write, isMobile);
  await expect(write).toHaveAttribute("aria-pressed", "true");
  const moving = practice.locator(".is-reordering");
  await expect(moving).toHaveCSS("scale", "0.98");
  await expect(moving).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.screenshot({
    path: `/tmp/180-reorder-items-${info.project.name}.png`,
  });
  const target = (await items.first().boundingBox())!;
  await drag.move(target.y + target.height / 2 - 12);
  await expect(titles).toHaveText([/Write/, /Read/]);
  await drag.end();
  await expect(practice.locator(".is-reordering")).toHaveCount(0);
  await expect(items.locator(":scope[open]")).toHaveCount(0);

  const cancel = await pressHandle(
    page,
    practice.getByRole("button", { name: "Reorder Read", exact: true }),
    isMobile,
  );
  await expect(practice.locator(".is-reordering")).toHaveCount(1);
  const first = (await items.first().boundingBox())!;
  await cancel.move(first.y + first.height / 2 - 12);
  await expect(titles).toHaveText([/Read/, /Write/]);
  await cancel.end(true);
  await expect(titles).toHaveText([/Write/, /Read/]);
  await expect(practice.locator(".is-reordering")).toHaveCount(0);

  await editor
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Apply today", exact: true })
    .click();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Practice", exact: true })
      .locator(".field-label"),
  ).toHaveText(["Write", "Read"]);
});

test("block and To-do list handles support keyboard pickup, drop, cancel and persistent order", async ({
  page,
  isMobile,
}) => {
  let editor = await openEditor(page);
  const blocks = editor.locator(
    ".customization-controls > [data-reorder-card=block]",
  );
  const school = editor.getByRole("button", {
    name: "Reorder School",
    exact: true,
  });
  await school.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await expect(blocks.first()).toHaveAttribute("aria-label", "Edit School");
  await expect(school).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(blocks.first()).toHaveAttribute("aria-label", "Edit General");
  await expect(editor).toBeVisible();
  const blockDrag = await pressHandle(page, school, isMobile);
  await expect(school).toHaveAttribute("aria-pressed", "true");
  const dialogBox = (await editor.boundingBox())!;
  // Hold at the upper edge to reach the previous large block by auto-scrolling.
  await blockDrag.move(dialogBox.y + 8);
  await expect(blocks.first()).toHaveAttribute("aria-label", "Edit School");
  await blockDrag.end();
  await editor
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Apply today", exact: true })
    .click();
  await expect(
    page.locator(".checkin-layout .checklist-block").first(),
  ).toHaveAttribute("aria-label", "School");

  await page
    .getByRole("button", { name: "Account and app information" })
    .click();
  await page
    .getByRole("button", { name: "Manage To-do lists", exact: true })
    .click();
  editor = page.getByRole("dialog", {
    name: "Manage To-do lists",
    exact: true,
  });
  const listCards = editor.locator("[data-reorder-card=list]");
  const life = editor.getByRole("button", {
    name: "Reorder Life list",
    exact: true,
  });
  await life.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(listCards.first().locator("h3")).toHaveText("Life");
  await page.keyboard.press("Escape");
  await expect(listCards.first().locator("h3")).toHaveText("School");
  const listDrag = await pressHandle(page, life, isMobile);
  await expect(life).toHaveAttribute("aria-pressed", "true");
  const firstList = (await listCards.first().boundingBox())!;
  await listDrag.move(firstList.y + firstList.height / 2 - 10);
  await expect(listCards.first().locator("h3")).toHaveText("Life");
  await listDrag.end();
  await expect(editor.locator(".is-reordering")).toHaveCount(0);
  await editor
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    page.locator(".task-topics > .checklist-block").first(),
  ).toHaveAttribute("aria-label", "Life");
  await page.reload();
  await page.getByRole("button", { name: "To-do", exact: true }).click();
  await expect(
    page.locator(".task-topics > .checklist-block").first(),
  ).toHaveAttribute("aria-label", "Life");
});
