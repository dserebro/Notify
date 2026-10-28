import { describe, expect, it } from "vitest";
import { arraybuffer2base64String } from "../../src/util/arraybufferutil";

describe("arraybuffer2base64String", () => {
    it("encodes an empty buffer to an empty string", () => {
        expect(arraybuffer2base64String(new ArrayBuffer(0))).toBe("");
    });

    it("round-trips bytes through standard base64", () => {
        const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
        expect(arraybuffer2base64String(bytes.buffer)).toBe("aGVsbG8=");
        // Spot-check decode: the browser's atob reverses our encoding.
        expect(atob("aGVsbG8=")).toBe("hello");
    });

    it("handles high bytes (non-ASCII) without corruption", () => {
        // 0x00-0xFF stress: every byte must survive the encode because
        // the PushSubscription keys are raw binary.
        const bytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) bytes[i] = i;
        const encoded = arraybuffer2base64String(bytes.buffer);
        const decoded = atob(encoded);
        expect(decoded.length).toBe(256);
        for (let i = 0; i < 256; i++) {
            expect(decoded.charCodeAt(i)).toBe(i);
        }
    });

    it("accepts an ArrayBuffer carved out of a larger Uint8Array", () => {
        const source = new Uint8Array([0, 0, 1, 2, 3, 4, 0]);
        // arraybuffer2base64String walks the full underlying buffer: it
        // takes an ArrayBuffer, not a view. Document the current
        // behavior so future callers do not accidentally pass a slice
        // and get the wrong window.
        const encoded = arraybuffer2base64String(source.buffer);
        const decoded = atob(encoded);
        expect(decoded).toBe(String.fromCharCode(0, 0, 1, 2, 3, 4, 0));
    });
});
