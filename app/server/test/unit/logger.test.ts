import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger.ts";

/**
 * JSON-lines logger: level filtering, stdout/stderr routing, and the
 * line shape (reserved keys cannot be overridden by meta).
 */

let out: string[];
let err: string[];

beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        out.push(String(chunk));
        return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        err.push(String(chunk));
        return true;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

const levels = (lines: string[]) =>
    lines.map((l) => (JSON.parse(l) as { level: string }).level);

describe("createLogger", () => {
    it("trace emits every level, routing warn/error to stderr", () => {
        const log = createLogger("trace");
        log.trace("t");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");
        expect(levels(out)).toEqual(["trace", "debug", "info"]);
        expect(levels(err)).toEqual(["warn", "error"]);
    });

    it("defaults to info and drops trace/debug", () => {
        const log = createLogger();
        log.trace("t");
        log.debug("d");
        log.info("i");
        expect(levels(out)).toEqual(["info"]);
    });

    it("warn drops info and below", () => {
        const log = createLogger("warn");
        log.info("i");
        log.warn("w");
        log.error("e");
        expect(out).toEqual([]);
        expect(levels(err)).toEqual(["warn", "error"]);
    });

    it("error keeps only error", () => {
        const log = createLogger("error");
        log.warn("w");
        log.error("e");
        expect(levels(err)).toEqual(["error"]);
    });

    it("writes one JSON line with time/level/msg and meta", () => {
        createLogger("info").info("hello", {
            id: 7,
            time: "spoofed",
            level: "spoofed",
            msg: "spoofed",
        });
        expect(out).toHaveLength(1);
        expect(out[0]?.endsWith("\n")).toBe(true);
        const line = JSON.parse(out[0] as string) as Record<string, unknown>;
        expect(line).toMatchObject({ level: "info", msg: "hello", id: 7 });
        expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
