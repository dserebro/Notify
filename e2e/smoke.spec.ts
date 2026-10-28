import { expect, test } from "@playwright/test";

/**
 * Chromium smoke tests for the built Notify server + Vite PWA bundle.
 *
 * The server is booted by `playwright.config.ts`'s `webServer` with a
 * sandboxed `DATABASE_PATH` under `e2e/.data/` and an `SENDKEY` of
 * `e2e-sendkey`. The tests cover: PWA shell load, manifest serving,
 * service-worker registration, the public `/api/keys` endpoint, both
 * the unauthenticated and the authenticated `/api/notify` paths, and
 * `/api/health`.
 */

test("PWA loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/notify/i);
    // `#app` is the Preact mount point; wait for it to be populated by
    // the client bundle rather than relying on a timeout.
    const app = page.locator("#app");
    await expect(app).toHaveCount(1);
    await expect
        .poll(async () => (await app.innerHTML()).length, { timeout: 5000 })
        .toBeGreaterThan(0);
});

test("manifest is served", async ({ page }) => {
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(typeof manifest.name).toBe("string");
    expect(manifest.name.length).toBeGreaterThan(0);
});

test("service worker registers", async ({ page }) => {
    await page.goto("/");
    // The frontend registers the SW via `useRegisterSW` on `window.load`,
    // which fires after `page.goto`. Poll `getRegistration()` up to 5s
    // and assert that it is active (or at least installing).
    const state = await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) {
            return { ok: false, reason: "no serviceWorker on navigator" };
        }
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg?.active || reg?.installing) {
                return {
                    ok: true,
                    active: Boolean(reg.active),
                    installing: Boolean(reg.installing),
                };
            }
            await new Promise((r) => setTimeout(r, 100));
        }
        return { ok: false, reason: "timed out waiting for registration" };
    });
    expect(state.ok, JSON.stringify(state)).toBe(true);
});

test("GET /api/keys returns a VAPID public key", async ({ page }) => {
    const response = await page.request.get("/api/keys");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successful).toBe(true);
    expect(typeof body.data).toBe("string");
    expect(body.data.length).toBeGreaterThan(0);
});

test("POST /api/notify without Authorization returns 401", async ({ page }) => {
    const response = await page.request.post("/api/notify", {
        headers: { "Content-Type": "application/json" },
        data: { title: "t", message: "m" },
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.successful).toBe(false);
    expect(body.error.type).toBe("auth_required");
});

test("POST /api/notify with bearer sendkey returns notified", async ({
    page,
}) => {
    const response = await page.request.post("/api/notify", {
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer e2e-sendkey",
        },
        data: { title: "t", message: "m" },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.successful).toBe(true);
    expect(body.data.message).toBe("notified");
});

test("GET /api/health returns ok", async ({ page }) => {
    const response = await page.request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
});
