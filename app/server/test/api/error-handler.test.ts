import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../../src/logger.ts";
import { TEST_SENDKEY } from "../fixtures/scenarios.ts";
import { bearer, type Harness, makeHarness } from "./helpers.ts";

/**
 * Global `app.onError`: an unhandled exception in a route becomes the
 * `internal_error` envelope with JSON + `Cache-Control: no-cache`
 * (replacement for the legacy `util/oakreturn.ts`), and the internal
 * error message is logged but never leaked to the client.
 */

describe("app.onError", () => {
    let harness: Harness;
    let errors: { msg: string; meta?: Record<string, unknown> }[];

    beforeEach(() => {
        errors = [];
        const spyLogger: Logger = {
            trace: () => {},
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: (msg, meta) => errors.push({ msg, meta }),
        };
        harness = makeHarness({ logger: spyLogger });
        harness.repository.listAll = () => {
            throw new Error("boom");
        };
    });

    afterEach(() => {
        harness.teardown();
    });

    it("returns the internal_error envelope with no-cache headers", async () => {
        const res = await harness.app.request("/api/notify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...bearer(TEST_SENDKEY),
            },
            body: JSON.stringify({ title: "t", message: "m" }),
        });
        expect(res.status).toBe(500);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(res.headers.get("cache-control")).toBe("no-cache");
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({
            successful: false,
            error: {
                type: "internal_error",
                message: "An internal error occurred",
            },
        });
        expect(text).not.toContain("boom");
        expect(errors).toHaveLength(1);
        expect(errors[0]?.msg).toBe("unhandled error");
        expect(errors[0]?.meta).toMatchObject({ error: "boom" });
    });
});
