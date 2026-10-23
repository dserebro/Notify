import { test, expect } from "@playwright/test";

/**
 * Service worker and PWA infrastructure tests.
 * Based on QA report flow: "Service worker registration"
 */
test.describe("Service Worker", () => {
  test("sw.js is served correctly", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);

    const contentType = response.headers()["content-type"] ?? "";
    // Service worker must be served as JavaScript
    expect(contentType).toMatch(/javascript|text\/plain/);
  });

  test("service worker registers with correct scope", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // QA report: navigator.serviceWorker.getRegistrations() returns one
    // registration with scope "http://localhost:8787/"
    const registrations = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.map((r) => ({ scope: r.scope }));
    });

    expect(registrations.length).toBeGreaterThanOrEqual(1);
    const scopes = registrations.map((r) => r.scope);
    expect(scopes.some((s) => s.includes("localhost:8787"))).toBe(true);
  });
});

test.describe("Static assets", () => {
  test("index.html loads with HTTP 200", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
  });

  test("page title is present", async ({ page }) => {
    await page.goto("/");
    // The Preact PWA should have a non-empty title
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});
