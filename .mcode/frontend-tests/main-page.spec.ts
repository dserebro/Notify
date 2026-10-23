import { test, expect } from "@playwright/test";

/**
 * Main page / landing page tests.
 * Based on QA report flow: "Main page / landing (/)"
 * All selectors verified by browser exploration.
 */
test.describe("Main page", () => {
  test("loads with toggle switch visible", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // QA report: Toggle/switch: input#basic-switch[role="switch"]
    const toggle = page.locator("input#basic-switch");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("role", "switch");
    await expect(toggle).toHaveAttribute("type", "checkbox");
  });

  test("INSTALL button is not rendered in headless (PWA install prompt unavailable)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // QA report known gap: PWA install prompt (beforeinstallprompt event) is not
    // fired in headless Chrome. The app correctly hides the INSTALL button when
    // the event has not fired — installInfo is null so the button is not rendered.
    // Verify the app gracefully omits the button rather than rendering a broken one.
    const installBtn = page.locator("button.smallbtn__PSY3t");
    await expect(installBtn).not.toBeAttached();
  });

  test("toggle switch is unchecked by default", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const toggle = page.locator("input#basic-switch");
    await expect(toggle).not.toBeChecked();
  });

  test("renders two empty message lists", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // QA report: Message lists: ul.messagelist__FIfRI (two of them, both empty)
    const lists = page.locator("ul.messagelist__FIfRI");
    await expect(lists).toHaveCount(2);

    // Both should be empty (no child items)
    const list1 = lists.nth(0);
    const list2 = lists.nth(1);
    await expect(list1).toBeEmpty();
    await expect(list2).toBeEmpty();
  });

  test("app root and header are present", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // QA report: App root: div.app__SDpv1, Header: div.header__lnNCj
    await expect(page.locator("div.app__SDpv1")).toBeVisible();
    await expect(page.locator("div.header__lnNCj")).toBeVisible();
  });

  test("main content area is present and attached", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // QA report: Main content area (messages.css grid).
    // The grid container is attached to DOM but has zero height when message
    // lists are empty — use toBeAttached() rather than toBeVisible().
    await expect(page.locator("div.main__MgiwP")).toBeAttached();
  });

  test("toggle click in headless environment shows snackbar error", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const toggle = page.locator("input#basic-switch");
    await toggle.click();

    // QA report: After click in headless environment (no push API),
    // div.mdc-snackbar__text contains the login error message
    const snackbarText = page.locator("div.mdc-snackbar__text");
    await expect(snackbarText).toBeVisible({ timeout: 5000 });
    await expect(snackbarText).toContainText(
      "Login action failed: Error: Could not subscribe to push service"
    );
  });
});
