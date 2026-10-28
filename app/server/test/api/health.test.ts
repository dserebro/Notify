import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Harness, makeHarness } from "./helpers.ts";

describe("GET /api/health", () => {
    let harness: Harness;

    beforeEach(() => {
        harness = makeHarness();
    });

    afterEach(() => {
        harness.teardown();
    });

    it("returns 200 and {status: 'ok'}", async () => {
        const res = await harness.app.request("/api/health");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ok" });
    });
});
