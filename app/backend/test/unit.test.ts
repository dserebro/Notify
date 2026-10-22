import { describe, it, expect } from "vitest";
import { compareStringSafe } from "../src/util/crypto";
import { validateVapidKey, validateEmail, validatePort } from "../src/util/commandvalidator";
import { b64ToUrlEncoded, urlEncodedToB64, generateRandomId, exportPublicKeyPair, arrayBufferToBase64 } from "../src/webpush/util";
import { MessageValidator } from "../src/types/message";

describe("compareStringSafe", () => {
    it("returns true for equal strings", () => {
        expect(compareStringSafe("hello", "hello")).toBe(true);
    });

    it("returns false for different strings", () => {
        expect(compareStringSafe("hello", "world")).toBe(false);
    });

    it("returns false for different lengths", () => {
        expect(compareStringSafe("short", "longer")).toBe(false);
    });

    it("returns true for empty strings", () => {
        expect(compareStringSafe("", "")).toBe(true);
    });
});

describe("validateVapidKey", () => {
    it("returns true for valid base64 encoded JSON", () => {
        const key = btoa(JSON.stringify({ test: "key" }));
        expect(validateVapidKey(key)).toBe(true);
    });

    it("returns false for invalid base64", () => {
        expect(validateVapidKey("not-valid!!!")).toBe(false);
    });
});

describe("validateEmail", () => {
    it("returns valid email unchanged", () => {
        expect(validateEmail("test@example.com")).toBe("test@example.com");
    });

    it("throws for invalid email", () => {
        expect(() => validateEmail("invalid")).toThrow("Invalid email address");
    });
});

describe("validatePort", () => {
    it("returns valid port as number", () => {
        expect(validatePort("8787")).toBe(8787);
    });

    it("throws for out-of-range port", () => {
        expect(() => validatePort("0")).toThrow("Invalid port number");
        expect(() => validatePort("99999")).toThrow("Invalid port number");
    });
});

describe("webpush util", () => {
    it("b64ToUrlEncoded converts base64 to URL-safe", () => {
        expect(b64ToUrlEncoded("abc+def/ghi=")).toBe("abc-def_ghi");
    });

    it("urlEncodedToB64 converts URL-safe to base64", () => {
        expect(urlEncodedToB64("abc-def_ghi")).toBe("abc+def/ghi=");
    });

    it("generateRandomId returns hex string of expected length", () => {
        const id = generateRandomId();
        expect(id).toHaveLength(32); // 16 bytes = 32 hex chars
        expect(/^[0-9a-f]+$/.test(id)).toBe(true);
    });

    it("generateRandomId with custom size", () => {
        const id = generateRandomId(8);
        expect(id).toHaveLength(16); // 8 bytes = 16 hex chars
    });

    it("exportPublicKeyPair concatenates x and y coordinates", () => {
        const key = { x: "AAAA", y: "BBBB" };
        const result = exportPublicKeyPair(key);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    it("arrayBufferToBase64 encodes correctly", () => {
        const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
        expect(arrayBufferToBase64(buffer)).toBe("SGVsbG8=");
    });
});

describe("MessageValidator", () => {
    it("accepts valid message", () => {
        const result = MessageValidator.safeParse({
            title: "Test",
            message: "Hello",
        });
        expect(result.success).toBe(true);
    });

    it("accepts message with optional fields", () => {
        const result = MessageValidator.safeParse({
            title: "Test",
            message: "Hello",
            icon: "https://example.com/icon.png",
            tags: ["tag1", "tag2"],
        });
        expect(result.success).toBe(true);
    });

    it("rejects empty title", () => {
        const result = MessageValidator.safeParse({
            title: "",
            message: "Hello",
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing message", () => {
        const result = MessageValidator.safeParse({
            title: "Test",
        });
        expect(result.success).toBe(false);
    });

    it("rejects too-long title", () => {
        const result = MessageValidator.safeParse({
            title: "x".repeat(1025),
            message: "Hello",
        });
        expect(result.success).toBe(false);
    });
});
