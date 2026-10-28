import { describe, expect, it } from "vitest";
import { constantTimeEqual, parseBearer } from "../../src/middleware/auth.ts";

/**
 * Unit tests for the two auth helpers. The constant-time compare must
 * reject different-length inputs fast (so timing never leaks the length
 * of a secret), and the bearer parser must only accept well-formed
 * `Bearer <token>` headers.
 */

describe("constantTimeEqual", () => {
    it("returns true for identical strings", () => {
        expect(constantTimeEqual("abc", "abc")).toBe(true);
        expect(constantTimeEqual("", "")).toBe(true);
        expect(
            constantTimeEqual(
                "test-fixture-sendkey-3b9f0c1e7a",
                "test-fixture-sendkey-3b9f0c1e7a",
            ),
        ).toBe(true);
    });

    it("returns false on different lengths without comparing bytes", () => {
        expect(constantTimeEqual("abc", "abcd")).toBe(false);
        expect(constantTimeEqual("", "x")).toBe(false);
        expect(constantTimeEqual("x", "")).toBe(false);
    });

    it("returns false for same-length but different values", () => {
        expect(constantTimeEqual("abc", "abd")).toBe(false);
        expect(constantTimeEqual("1234567890", "1234567891")).toBe(false);
    });
});

describe("parseBearer", () => {
    it("extracts the token from a well-formed header", () => {
        expect(parseBearer("Bearer abcdef")).toBe("abcdef");
    });

    it("accepts a lowercase 'bearer' scheme", () => {
        expect(parseBearer("bearer abcdef")).toBe("abcdef");
    });

    it("returns null for a missing header", () => {
        expect(parseBearer(undefined)).toBeNull();
        expect(parseBearer(null)).toBeNull();
        expect(parseBearer("")).toBeNull();
    });

    it("returns null for the wrong scheme", () => {
        expect(parseBearer("Basic abcdef")).toBeNull();
        expect(parseBearer("Token abcdef")).toBeNull();
    });

    it("returns null when the token is missing", () => {
        expect(parseBearer("Bearer")).toBeNull();
        expect(parseBearer("Bearer ")).toBeNull();
    });

    it("returns null for a bare token with no scheme", () => {
        // No space means the whole string is parsed as the scheme and
        // the token slot is undefined — must be rejected.
        expect(parseBearer("abcdef")).toBeNull();
    });
});
