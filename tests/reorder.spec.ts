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
      name: lists ? "Edit To-Do lists" : "Edit Daily Checklist",
      exact: true,
    })
    .click();
  return page.getByRole("dialog", {
    name: lists ? "Edit To-Do lists" : "Edit Daily Checklist",
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

async function newBlock(editor: Locator, title: string) {
  await editor
    .getByRole("button", { name: "Add block", exact: true })
    .first()
    .click();
  await editor
    .getByRole("textbox", { name: "Block name", exact: true })
    .fill(title);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
}
async function addCheck(editor: Locator, question: string) {
  await editor.getByRole("button", { name: "Add item", exact: true }).click();
  await editor.getByRole("button", { name: /^Yes \/ No(?:\s|$)/ }).click();
  await editor
    .getByRole("textbox", { name: "Question", exact: true })
    .fill(question);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
}

test("hold handles reorder compact item rows, highlight the moving row, and cancel safely", async ({
  page,
  isMobile,
}, info) => {
  const editor = await openEditor(page);
  await newBlock(editor, "Practice");
  for (const name of ["Read", "Write"]) await addCheck(editor, name);
  const items = editor.locator("[data-reorder-card=item]");
  const titles = items.getByRole("button", { name: /^Edit / });
  const write = editor.getByRole("button", {
    name: "Reorder Write",
    exact: true,
  });
  await write.click();
  await expect(titles).toHaveText([/Read/, /Write/]);
  await expect(
    editor.getByRole("textbox", { name: "Question", exact: true }),
  ).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: /^Move .+ (up|down)$/ }),
  ).toHaveCount(0);

  const drag = await pressHandle(page, write, isMobile);
  await expect(write).toHaveAttribute("aria-pressed", "true");
  const moving = editor.locator("[data-reorder-card=item].is-reordering");
  await expect(moving).toHaveCSS("scale", "0.98");
  await expect(moving).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.screenshot({
    path: `/tmp/180-reorder-items-${info.project.name}.png`,
  });
  const target = (await items.first().boundingBox())!;
  await drag.move(target.y + target.height / 2 - 12);
  await expect(titles).toHaveText([/Write/, /Read/]);
  await drag.end();
  await expect(editor.locator(".is-reordering")).toHaveCount(0);
  await expect(
    editor.getByRole("textbox", { name: "Question", exact: true }),
  ).toHaveCount(0);

  const cancel = await pressHandle(
    page,
    editor.getByRole("button", { name: "Reorder Read", exact: true }),
    isMobile,
  );
  await expect(editor.locator(".is-reordering")).toHaveCount(1);
  const first = (await items.first().boundingBox())!;
  await cancel.move(first.y + first.height / 2 - 12);
  await expect(titles).toHaveText([/Read/, /Write/]);
  await cancel.end(true);
  await expect(titles).toHaveText([/Write/, /Read/]);
  await expect(editor.locator(".is-reordering")).toHaveCount(0);

  await editor
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Apply today", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
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
  const blocks = editor.locator("[data-reorder-card=block]");
  const school = editor.getByRole("button", {
    name: "Reorder School",
    exact: true,
  });
  await school.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await expect(
    blocks.first().getByRole("button", { name: "Open School", exact: true }),
  ).toBeVisible();
  await expect(school).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    blocks.first().getByRole("button", { name: "Open General", exact: true }),
  ).toBeVisible();
  await expect(editor).toBeVisible();
  const blockDrag = await pressHandle(page, school, isMobile);
  await expect(school).toHaveAttribute("aria-pressed", "true");
  const firstBlock = (await blocks.first().boundingBox())!;
  await blockDrag.move(firstBlock.y + firstBlock.height / 2 - 10);
  await expect(
    blocks.first().getByRole("button", { name: "Open School", exact: true }),
  ).toBeVisible();
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
    .getByRole("button", { name: "Edit To-Do lists", exact: true })
    .click();
  editor = page.getByRole("dialog", {
    name: "Edit To-Do lists",
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
  await expect(
    listCards.first().getByRole("button", { name: "Edit Life", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    listCards.first().getByRole("button", { name: "Edit School", exact: true }),
  ).toBeVisible();
  const listDrag = await pressHandle(page, life, isMobile);
  await expect(life).toHaveAttribute("aria-pressed", "true");
  const firstList = (await listCards.first().boundingBox())!;
  await listDrag.move(firstList.y + firstList.height / 2 - 10);
  await expect(
    listCards.first().getByRole("button", { name: "Edit Life", exact: true }),
  ).toBeVisible();
  await listDrag.end();
  await expect(editor.locator(".is-reordering")).toHaveCount(0);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
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
