import { afterEach, describe, expect, it } from "vitest";
import { type Harness, makeHarness } from "./helpers.ts";

/**
 * CORS preflight on `/api/*` paths. With `cors: true` the response
 * carries the standard `Access-Control-Allow-*` headers; with `cors:
 * false` nothing CORS-related leaks out.
 */

describe("CORS", () => {
    let harness: Harness;
    afterEach(() => {
        harness.teardown();
    });

    it("sets CORS headers on OPTIONS preflight when cors=true", async () => {
        harness = makeHarness({ cors: true });
        const res = await harness.app.request("/api/keys", {
            method: "OPTIONS",
            headers: {
                Origin: "https://example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        });
        // Hono's default cors() returns 204 for preflights with
        // ACAO: * (any origin). The exact status is not load-bearing;
        // the header is.
        expect([200, 204]).toContain(res.status);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
        expect(res.headers.get("access-control-allow-methods")).not.toBeNull();
    });

    it("sets ACAO on simple GET when cors=true", async () => {
        harness = makeHarness({ cors: true });
        const res = await harness.app.request("/api/keys", {
            headers: { Origin: "https://example.com" },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("does not add CORS headers when cors=false", async () => {
        harness = makeHarness({ cors: false });
        const res = await harness.app.request("/api/keys", {
            headers: { Origin: "https://example.com" },
        });
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
});

describe("CORS preflight when cors=false", () => {
    let harness: Harness;
    afterEach(() => {
        harness.teardown();
    });

    it("OPTIONS to /api/keys lands on the 405 fallback (no CORS)", async () => {
        harness = makeHarness({ cors: false });
        const res = await harness.app.request("/api/keys", {
            method: "OPTIONS",
            headers: {
                Origin: "https://example.com",
                "Access-Control-Request-Method": "GET",
            },
        });
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        // Without CORS, OPTIONS hits the method-not-allowed catch-all.
        expect(res.status).toBe(405);
    });
});
