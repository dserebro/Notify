import { describe, expect, it } from "vitest";
import {
    enforceMessageSize,
    MESSAGE_MAX_BYTES,
    MessageSchema,
} from "../src/index.ts";

describe("enforceMessageSize", () => {
    it("uses the legacy 2048 ceiling", () => {
        expect(MESSAGE_MAX_BYTES).toBe(2048);
    });

    it("accepts exactly 2048 and rejects 2049 code units", () => {
        expect(enforceMessageSize("a".repeat(2048))).toBe(true);
        expect(enforceMessageSize("a".repeat(2049))).toBe(false);
    });

    // Counts UTF-16 code units (like the legacy `.length` check), not
    // UTF-8 bytes: "é" is 1 unit / 2 bytes, "😀" is 2 units / 4 bytes.
    it("counts UTF-16 code units for multi-byte characters", () => {
        expect(enforceMessageSize("é".repeat(2048))).toBe(true);
        expect(enforceMessageSize("é".repeat(2049))).toBe(false);
        expect(enforceMessageSize("😀".repeat(1024))).toBe(true);
        expect(enforceMessageSize(`${"😀".repeat(1024)}a`)).toBe(false);
    });
});

describe("MessageSchema", () => {
    it("accepts a minimal and a full message", () => {
        expect(
            MessageSchema.safeParse({ title: "t", message: "m" }).success,
        ).toBe(true);
        expect(
            MessageSchema.safeParse({
                title: "t",
                message: "m",
                icon: "https://example.com/i.png",
                tags: ["a", "b"],
            }).success,
        ).toBe(true);
    });

    it.each([
        ["empty title", { title: "", message: "m" }],
        ["missing message", { title: "t" }],
        ["over-long title", { title: "t".repeat(1025), message: "m" }],
        ["non-URL icon", { title: "t", message: "m", icon: "not a url" }],
        ["empty tag", { title: "t", message: "m", tags: [""] }],
    ])("rejects %s", (_label, input) => {
        expect(MessageSchema.safeParse(input).success).toBe(false);
    });

    it("strips unknown keys such as the legacy iconUrl", () => {
        const parsed = MessageSchema.parse({
            title: "t",
            message: "m",
            iconUrl: "https://example.com/i.png",
        });
        expect(parsed).toEqual({ title: "t", message: "m" });
    });
});
