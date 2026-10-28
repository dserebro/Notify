import { describe, expect, it } from "vitest";
import { stringToU8Array, urlEncodedToB64 } from "../../src/webpush/util.ts";
import { generateVapidJwt } from "../../src/webpush/vapid.ts";
import { TEST_SUB, TEST_VAPID_KEY } from "../fixtures/scenarios.ts";

/**
 * Unit tests for the VAPID JWT signer. The signature path is checked
 * end-to-end by importing the server's public key as an ECDSA verify
 * key and running WebCrypto `verify()` on the JWT parts, so a change in
 * header bytes, body claims or signature shape is caught immediately.
 */

const AUDIENCE = "https://push.example.com";

function base64UrlDecode(input: string): Uint8Array {
    const padded = urlEncodedToB64(input);
    const binary = atob(padded);
    return stringToU8Array(binary);
}

function base64UrlDecodeText(input: string): string {
    return new TextDecoder().decode(base64UrlDecode(input));
}

describe("generateVapidJwt", () => {
    it("produces a 3-part JWT", async () => {
        const { token } = await generateVapidJwt(
            TEST_SUB,
            AUDIENCE,
            TEST_VAPID_KEY,
        );
        const parts = token.split(".");
        expect(parts).toHaveLength(3);
        for (const part of parts) {
            expect(part.length).toBeGreaterThan(0);
        }
    });

    it("has a header of {typ:'JWT', alg:'ES256'}", async () => {
        const { token } = await generateVapidJwt(
            TEST_SUB,
            AUDIENCE,
            TEST_VAPID_KEY,
        );
        const [headerPart] = token.split(".");
        if (!headerPart) throw new Error("missing header");
        const header = JSON.parse(base64UrlDecodeText(headerPart)) as Record<
            string,
            unknown
        >;
        expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    });

    it("has aud and an exp roughly 12h ahead", async () => {
        const before = Math.floor(Date.now() / 1000);
        const { token } = await generateVapidJwt(
            TEST_SUB,
            AUDIENCE,
            TEST_VAPID_KEY,
        );
        const after = Math.floor(Date.now() / 1000);
        const [, bodyPart] = token.split(".");
        if (!bodyPart) throw new Error("missing body");
        const body = JSON.parse(base64UrlDecodeText(bodyPart)) as {
            aud: string;
            exp: number;
            sub: string;
        };
        expect(body.aud).toBe(AUDIENCE);
        expect(body.sub).toBe(TEST_SUB);
        // 12h = 43200s. Allow a few seconds of jitter around the two
        // Date.now() samples that bracketed the call.
        const twelveHours = 12 * 60 * 60;
        expect(body.exp).toBeGreaterThanOrEqual(before + twelveHours - 2);
        expect(body.exp).toBeLessThanOrEqual(after + twelveHours + 2);
    });

    it("verifies against the derived public key via WebCrypto", async () => {
        const { token, publicKey } = await generateVapidJwt(
            TEST_SUB,
            AUDIENCE,
            TEST_VAPID_KEY,
        );
        const parts = token.split(".");
        if (parts.length !== 3) throw new Error("not a 3-part JWT");
        const [headerB64, bodyB64, sigB64] = parts as [string, string, string];
        const signingInput = stringToU8Array(`${headerB64}.${bodyB64}`);
        const sig = base64UrlDecode(sigB64);

        // The uncompressed P-256 public key is `0x04 || x(32) || y(32)`.
        const raw = base64UrlDecode(publicKey);
        expect(raw.byteLength).toBe(65);
        expect(raw[0]).toBe(0x04);
        const key = await crypto.subtle.importKey(
            "raw",
            raw,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"],
        );
        const verified = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            sig,
            signingInput,
        );
        expect(verified).toBe(true);
    });
});
