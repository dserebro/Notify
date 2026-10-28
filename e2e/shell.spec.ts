import { expect, test } from "@playwright/test";

const PROTECTED = "http://127.0.0.1:18788";

test.describe("landing shell", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");
    });

    test("title is 'notify app'", async ({ page }) => {
        await expect(page).toHaveTitle("notify app");
    });

    test("body background is rgb(250,250,250) and font is Roboto", async ({
        page,
    }) => {
        const style = await page.evaluate(() => {
            const cs = getComputedStyle(document.body);
            return { bg: cs.backgroundColor, font: cs.fontFamily };
        });
        expect(style.bg).toBe("rgb(250, 250, 250)");
        expect(style.font).toContain("Roboto");
    });

    test("switch is unchecked and top-left, INSTALL button top-right", async ({
        page,
    }) => {
        const sw = page.getByRole("switch");
        await expect(sw).toBeVisible();
        await expect(sw).not.toBeChecked();
        // The INSTALL button only renders once the browser fires
        // `beforeinstallprompt`; headless Chromium never does, so emit it.
        await page.evaluate(() => {
            const ev = new Event("beforeinstallprompt", { cancelable: true });
            Object.assign(ev, {
                prompt: () => ((window as any).__prompted = true),
                userChoice: new Promise(() => {}),
            });
            window.dispatchEvent(ev);
        });
        const install = page.getByRole("button", { name: "INSTALL" });
        await expect(install).toBeVisible();
        const sb = (await sw.boundingBox())!;
        const ib = (await install.boundingBox())!;
        const vw = page.viewportSize()!.width;
        expect(sb.x + sb.width / 2).toBeLessThan(vw / 2);
        expect(ib.x + ib.width / 2).toBeGreaterThan(vw / 2);
        expect(sb.y).toBeLessThan(150);
        expect(ib.y).toBeLessThan(150);
        await install.click();
        expect(await page.evaluate(() => (window as any).__prompted)).toBe(
            true,
        );
    });

    test("clicking switch without push support shows failure snackbar", async ({
        page,
    }) => {
        const sw = page.getByRole("switch");
        await sw.click();
        await expect(
            page.getByText(
                "Login action failed: Error: Could not subscribe to push service",
            ),
        ).toBeVisible({ timeout: 10000 });
        await expect(sw).not.toBeChecked();
    });
});

test.describe("service worker and manifest", () => {
    test("service worker scope is the origin root", async ({ page }) => {
        await page.goto("/");
        const scope = await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.ready;
            return reg.scope;
        });
        expect(scope).toBe("http://127.0.0.1:18787/");
    });

    test("/sw.js is served with no-cache", async ({ request }) => {
        const r = await request.get("/sw.js");
        expect(r.status()).toBe(200);
        expect(r.headers()["cache-control"]).toContain("no-cache");
        expect(r.headers()["content-type"]).toContain("javascript");
    });

    test("manifest content", async ({ request }) => {
        const r = await request.get("/manifest.webmanifest");
        expect(r.status()).toBe(200);
        const m = await r.json();
        expect(m.name).toBe("notify app");
        expect(m.short_name).toBe("notify");
        const srcs = (m.icons as { src: string }[]).map((i) => i.src);
        expect(srcs).toContain("/assets/icons/notify_big.png");
        expect(srcs).toContain("/assets/icons/notify_small.png");
        for (const src of srcs) {
            const res = await request.get(src);
            expect(res.status(), src).toBe(200);
        }
    });
});

test.describe("LOGINKEY protected server", () => {
    test("/api/keys/auth reports login key required", async ({ request }) => {
        const r = await request.get(`${PROTECTED}/api/keys/auth`);
        expect(r.status()).toBe(200);
        expect((await r.json()).data).toBe(true);
    });

    test("/api/keys/auth reports not required on open server", async ({
        request,
    }) => {
        const r = await request.get("/api/keys/auth");
        expect((await r.json()).data).toBe(false);
    });

    test("POST /api/device without login key is rejected", async ({
        request,
    }) => {
        const r = await request.post(`${PROTECTED}/api/device`, {
            data: { web_push_data: {} },
        });
        expect(r.status()).toBe(401);
    });

    test("protected server still serves the shell", async ({ page }) => {
        await page.goto(`${PROTECTED}/`);
        await expect(page.getByRole("switch")).toBeVisible();
        await expect(page).toHaveTitle("notify app");
    });
});
