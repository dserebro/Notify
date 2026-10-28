import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_VAPID_PUBLIC_KEY } from "../fixtures/scenarios.ts";
import { type Harness, makeHarness } from "./helpers.ts";

/**
 * GET /api/keys returns the derived VAPID public key (the browser
 * passes it to `pushManager.subscribe({ applicationServerKey })`), and
 * GET /api/keys/auth reports whether a LOGINKEY is required for device
 * registration.
 */

describe("GET /api/keys", () => {
    let harness: Harness;
    beforeEach(() => {
        harness = makeHarness();
    });
    afterEach(() => {
        harness.teardown();
    });

    it("returns the public key with the success envelope", async () => {
        const res = await harness.app.request("/api/keys");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(res.headers.get("cache-control")).toBe("no-cache");
        const body = await res.json();
        expect(body).toEqual({ successful: true, data: TEST_VAPID_PUBLIC_KEY });
    });
});

describe("GET /api/keys/auth", () => {
    let harness: Harness;
    afterEach(() => {
        harness.teardown();
    });

    it("returns false when LOGINKEY is unset", async () => {
        harness = makeHarness({ loginkey: null });
        const res = await harness.app.request("/api/keys/auth");
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            successful: boolean;
            data: unknown;
        };
        expect(body.data).toBe(false);
    });

    it("returns true when LOGINKEY is set", async () => {
        harness = makeHarness({ loginkey: "configured-login-key" });
        const res = await harness.app.request("/api/keys/auth");
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            successful: boolean;
            data: unknown;
        };
        expect(body.data).toBe(true);
    });
});
