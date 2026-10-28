import { fromBinary, toBinary } from "@notify/shared";
import { describe, expect, it } from "vitest";

/**
 * The server encodes push payloads with `btoa(toBinary(JSON.stringify(x)))`
 * (see `app/server/src/webpush/webpush.ts`), and the service worker decodes
 * them with `JSON.parse(fromBinary(atob(payload)))` (see `src/sw.ts`).
 * This test replays the pipeline both ways to prove the wire format
 * round-trips cleanly through the exact code path running in production —
 * guarding the "push wire format could drift" risk in MILESTONE.md.
 */
const inputs = [
    "Hello",
    "éàñ 中文 😀",
    "",
    "a longer string containing emoji 🎉 and non-ASCII — 中文",
];

describe("wire format (toBinary + fromBinary over base64)", () => {
    for (const s of inputs) {
        it(`round-trips ${JSON.stringify(s)} through btoa/atob`, () => {
            const encoded = btoa(
                toBinary(JSON.stringify({ title: "t", message: s })),
            );
            const decoded = JSON.parse(fromBinary(atob(encoded))) as {
                title: string;
                message: string;
            };
            expect(decoded.title).toBe("t");
            expect(decoded.message).toBe(s);
        });
    }

    it("preserves every ASCII code unit when wrapped as a message body", () => {
        // Build a string of every ASCII character except NUL (which some
        // JSON parsers reject) so a drift of a single byte would show up
        // immediately.
        let ascii = "";
        for (let i = 1; i < 128; i++) ascii += String.fromCharCode(i);
        const encoded = btoa(
            toBinary(JSON.stringify({ title: "t", message: ascii })),
        );
        const decoded = JSON.parse(fromBinary(atob(encoded))) as {
            message: string;
        };
        expect(decoded.message).toBe(ascii);
    });
});
