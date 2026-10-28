import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../../src/logger.ts";
import { type Harness, makeHarness } from "./helpers.ts";

/**
 * Static-file serving + SPA fallback. A temp directory holds the
 * frontend layout:
 *   index.html, sw.js, assets/x.js, assets/index-AbC123_-.js,
 *   assets/icons/notify.png
 * Then:
 *   - a matching path serves the file;
 *   - an unknown path falls back to index.html (SPA);
 *   - sw.js carries `Cache-Control: no-cache`;
 *   - `/api/*` is NOT swallowed by the static handler.
 */

describe("static files + SPA fallback", () => {
    let frontendDir = "";
    let harness: Harness;

    beforeEach(() => {
        frontendDir = mkdtempSync(join(tmpdir(), "notify-fe-"));
        writeFileSync(join(frontendDir, "index.html"), "<html>INDEX</html>");
        writeFileSync(join(frontendDir, "sw.js"), "// service worker");
        mkdirSync(join(frontendDir, "assets"));
        writeFileSync(
            join(frontendDir, "assets", "x.js"),
            "console.log('asset');",
        );
        writeFileSync(
            join(frontendDir, "assets", "index-AbC123_-.js"),
            "console.log('hashed');",
        );
        mkdirSync(join(frontendDir, "assets", "icons"));
        writeFileSync(
            join(frontendDir, "assets", "icons", "notify.png"),
            "png",
        );
        harness = makeHarness({ frontend: frontendDir });
    });

    afterEach(() => {
        harness.teardown();
        rmSync(frontendDir, { recursive: true, force: true });
    });

    it("GET /index.html serves the file", async () => {
        const res = await harness.app.request("/index.html");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/text\/html/);
        expect(await res.text()).toBe("<html>INDEX</html>");
    });

    it("GET / serves index.html", async () => {
        const res = await harness.app.request("/");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/text\/html/);
        expect(await res.text()).toBe("<html>INDEX</html>");
    });

    it("GET /unknown falls back to index.html when Accept includes text/html", async () => {
        const res = await harness.app.request("/some/unknown/path", {
            headers: { Accept: "text/html" },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/text\/html/);
        expect(await res.text()).toBe("<html>INDEX</html>");
    });

    it("GET /sw.js has Cache-Control: no-cache", async () => {
        const res = await harness.app.request("/sw.js");
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-cache");
    });

    it("GET a fingerprinted /assets file uses the immutable cache rule", async () => {
        const res = await harness.app.request("/assets/index-AbC123_-.js");
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toContain("immutable");
    });

    it.each(["/assets/x.js", "/assets/icons/notify.png"])(
        "GET un-hashed %s is served with no-cache",
        async (path) => {
            const res = await harness.app.request(path);
            expect(res.status).toBe(200);
            expect(res.headers.get("cache-control")).toBe("no-cache");
        },
    );

    it("GET /api/anything is not swallowed by the static handler", async () => {
        const res = await harness.app.request("/api/does-not-exist", {
            headers: { Accept: "text/html" },
        });
        // Hono's own 404 — not an HTML index.html, which would mean the
        // static fallback was wrongly reached.
        expect(res.status).toBe(404);
        const body = await res.text();
        expect(body).not.toContain("INDEX");
    });

    it("a missing asset without Accept: text/html does not get index.html", async () => {
        const res = await harness.app.request("/assets/missing.js", {
            headers: { Accept: "*/*" },
        });
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("INDEX");
    });

    it("non-GET/HEAD requests pass through the static handler", async () => {
        const res = await harness.app.request("/index.html", {
            method: "POST",
        });
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("INDEX");
    });

    it("refuses paths that escape the frontend root", async () => {
        const secretName = `${basename(frontendDir)}-secret.txt`;
        const secretPath = join(dirname(frontendDir), secretName);
        writeFileSync(secretPath, "TOP SECRET");
        try {
            const res = await harness.app.request(`/..%2f${secretName}`, {
                headers: { Accept: "text/html" },
            });
            expect(res.status).toBe(404);
            expect(await res.text()).not.toContain("TOP SECRET");
        } finally {
            rmSync(secretPath, { force: true });
        }
    });

    it("a malformed percent-encoded path passes through", async () => {
        const res = await harness.app.request("/%E0%A4%A", {
            headers: { Accept: "text/html" },
        });
        expect(res.status).toBe(404);
    });

    it("answers If-None-Match with 304 for a file", async () => {
        const first = await harness.app.request("/sw.js");
        const etag = first.headers.get("etag");
        expect(etag).toBeTruthy();
        const res = await harness.app.request("/sw.js", {
            headers: { "If-None-Match": etag as string },
        });
        expect(res.status).toBe(304);
        expect(res.headers.get("etag")).toBe(etag);
        expect(res.headers.get("cache-control")).toBe(
            first.headers.get("cache-control"),
        );
    });

    it("answers If-None-Match with 304 for the SPA fallback", async () => {
        const first = await harness.app.request("/some/route", {
            headers: { Accept: "text/html" },
        });
        const etag = first.headers.get("etag");
        expect(etag).toBeTruthy();
        const res = await harness.app.request("/some/route", {
            headers: { Accept: "text/html", "If-None-Match": etag as string },
        });
        expect(res.status).toBe(304);
        expect(res.headers.get("cache-control")).toBe("no-cache");
    });

    it("falls through and logs when index.html is missing", async () => {
        const warnings: string[] = [];
        const logger: Logger = {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: (msg) => warnings.push(msg),
            error: () => {},
        };
        rmSync(join(frontendDir, "index.html"));
        const local = makeHarness({ frontend: frontendDir, logger });
        try {
            const res = await local.app.request("/some/route", {
                headers: { Accept: "text/html" },
            });
            expect(res.status).toBe(404);
            expect(warnings).toContain("static index.html missing");
        } finally {
            local.teardown();
        }
    });
});
