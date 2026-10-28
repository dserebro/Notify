import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../../src/logger.ts";
import { type Harness, makeHarness } from "./helpers.ts";

/**
 * Trust-proxy middleware: when `config.trustProxy` is true the server reads
 * `X-Forwarded-*` headers and logs them as a structured `request` line.
 * When false it ignores the headers entirely (the middleware is the sole
 * consumer of the config field, so an unset flag must be a true no-op).
 */

type LogEntry = {
    level: "trace" | "debug" | "info" | "warn" | "error";
    msg: string;
    meta?: Record<string, unknown>;
};

function captureLogger(bucket: LogEntry[]): Logger {
    const push =
        (level: LogEntry["level"]) =>
        (msg: string, meta?: Record<string, unknown>) => {
            bucket.push({ level, msg, meta });
        };
    return {
        trace: push("trace"),
        debug: push("debug"),
        info: push("info"),
        warn: push("warn"),
        error: push("error"),
    };
}

describe("trust-proxy middleware", () => {
    let harness: Harness;
    const entries: LogEntry[] = [];

    afterEach(() => {
        harness?.teardown();
        entries.length = 0;
    });

    describe("when trustProxy=true", () => {
        beforeEach(() => {
            harness = makeHarness({
                trustProxy: true,
                logger: captureLogger(entries),
            });
        });

        it("emits a `request` log line with the forwarded client IP", async () => {
            const res = await harness.app.request("/api/health", {
                headers: {
                    "x-forwarded-for": "203.0.113.7, 10.0.0.1",
                    "x-forwarded-proto": "https",
                    "x-forwarded-host": "notify.example.com",
                },
            });
            expect(res.status).toBe(200);
            const request = entries.find((e) => e.msg === "request");
            expect(request).toBeDefined();
            expect(request?.meta).toMatchObject({
                method: "GET",
                path: "/api/health",
                clientIp: "203.0.113.7",
                forwardedProto: "https",
                forwardedHost: "notify.example.com",
            });
        });

        it("tolerates missing X-Forwarded-For (clientIp=null)", async () => {
            const res = await harness.app.request("/api/health");
            expect(res.status).toBe(200);
            const request = entries.find((e) => e.msg === "request");
            expect(request?.meta).toMatchObject({ clientIp: null });
        });
    });

    describe("when trustProxy=false", () => {
        beforeEach(() => {
            harness = makeHarness({
                trustProxy: false,
                logger: captureLogger(entries),
            });
        });

        it("does not emit the structured `request` log line", async () => {
            const res = await harness.app.request("/api/health", {
                headers: { "x-forwarded-for": "203.0.113.7" },
            });
            expect(res.status).toBe(200);
            const request = entries.find((e) => e.msg === "request");
            expect(request).toBeUndefined();
        });
    });
});
