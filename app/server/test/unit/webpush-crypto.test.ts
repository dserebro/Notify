import type { webcrypto } from "node:crypto";
import type { WebPushData } from "@notify/shared";
import { WebPushResult } from "@notify/shared";
import { describe, expect, it } from "vitest";
import { hkdfGenerate } from "../../src/webpush/hkdf.ts";
import { encryptPayload, generateContext } from "../../src/webpush/message.ts";
import {
    arrayBufferToBase64,
    b64ToUrlEncoded,
    cryptoKeysToUint8Array,
    exportPublicKeyPair,
    stringToU8Array,
} from "../../src/webpush/util.ts";
import { sendPush } from "../../src/webpush/webpush.ts";
import { TEST_SUB, TEST_VAPID_KEY } from "../fixtures/scenarios.ts";

/**
 * `aesgcm` round-trip and HTTP-status mapping for the Web Push module.
 *
 * The round-trip generates a fresh subscriber P-256 keypair and 16-byte
 * auth secret, encrypts a plaintext with `encryptPayload`, then rebuilds
 * the HKDF chain from the subscriber's private key and decrypts the
 * ciphertext. Any divergence in the HKDF labels, salt length, record
 * padding or key export changes the output and the test fails.
 */

async function makeSubscriber(): Promise<{
    subscription: WebPushData;
    privateKey: webcrypto.CryptoKey;
    authSecret: Uint8Array;
}> {
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
    );
    const { publicKey } = await cryptoKeysToUint8Array(keyPair.publicKey);
    // Standard base64, same encoding `web_push_data.key` carries.
    let bin = "";
    publicKey.forEach((byte) => {
        bin += String.fromCharCode(byte);
    });
    const keyB64 = btoa(bin);

    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    let authBin = "";
    authSecret.forEach((byte) => {
        authBin += String.fromCharCode(byte);
    });
    const authB64 = btoa(authBin);

    return {
        subscription: {
            endpoint: "http://127.0.0.1:9/push-subscriber",
            key: keyB64,
            auth: authB64,
        },
        privateKey: keyPair.privateKey,
        authSecret,
    };
}

async function decryptPayload(
    ciphertext: ArrayBuffer,
    saltB64Url: string,
    serverPublicKeyB64Url: string,
    subscription: WebPushData,
    subscriberPrivateKey: webcrypto.CryptoKey,
    authSecret: Uint8Array,
): Promise<string> {
    // Rebuild the server's public key from the base64url(0x04 || x || y).
    const serverRaw = base64UrlToUint8Array(serverPublicKeyB64Url);
    if (serverRaw[0] !== 0x04 || serverRaw.byteLength !== 65) {
        throw new Error("server public key is not uncompressed P-256");
    }
    const serverPublicJwk: webcrypto.JsonWebKey = {
        kty: "EC",
        crv: "P-256",
        x: b64urlFromBytes(serverRaw.slice(1, 33)),
        y: b64urlFromBytes(serverRaw.slice(33, 65)),
        ext: true,
    };
    const serverPublicCrypto = await crypto.subtle.importKey(
        "jwk",
        serverPublicJwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        [],
    );

    // ECDH shared secret with the subscriber's private key.
    const sharedSecret = await crypto.subtle.deriveBits(
        { name: "ECDH", public: serverPublicCrypto },
        subscriberPrivateKey,
        256,
    );

    // Mirror `generatePRK` from message.ts: the auth secret is the HKDF
    // salt and "Content-Encoding: auth\x00" is the info.
    const authInfo = stringToU8Array("Content-Encoding: auth\x00");
    const prk = await hkdfGenerate(sharedSecret, authSecret, authInfo, 32);

    // Context is `P-256\x00` || client-pk-len(2 bytes) || client-pk ||
    // server-pk-len(2 bytes) || server-pk — same as `generateContext`.
    const serverKeyPair = {
        publicKey: serverPublicCrypto,
        privateKey: subscriberPrivateKey,
    };
    const context = await generateContext(subscription, serverKeyPair);

    const cekInfo = concat(
        stringToU8Array("Content-Encoding: aesgcm\x00"),
        context,
    );
    const nonceInfo = concat(
        stringToU8Array("Content-Encoding: nonce\x00"),
        context,
    );
    const salt = base64UrlToUint8Array(saltB64Url);
    const cek = await hkdfGenerate(prk, salt, cekInfo, 16);
    const nonce = await hkdfGenerate(prk, salt, nonceInfo, 12);

    const cekCrypto = await crypto.subtle.importKey(
        "raw",
        cek,
        "AES-GCM",
        true,
        ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", tagLength: 128, iv: nonce },
        cekCrypto,
        ciphertext,
    );
    // Strip the 2-byte padding prefix (zero padding bytes used).
    const bytes = new Uint8Array(decrypted);
    const paddingLen = (bytes[0] << 8) | bytes[1];
    return new TextDecoder().decode(bytes.slice(2 + paddingLen));
}

function base64UrlToUint8Array(input: string): Uint8Array {
    const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    return stringToU8Array(binary);
}

function b64urlFromBytes(bytes: Uint8Array): string {
    const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return b64ToUrlEncoded(arrayBufferToBase64(buf));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a, 0);
    out.set(b, a.byteLength);
    return out;
}

describe("encryptPayload", () => {
    it("round-trips a payload through aesgcm decryption", async () => {
        // encryptPayload uses stringToU8Array (1 byte per UTF-16 code
        // unit) so the input must be ASCII — upstream callers run the
        // user payload through `toBinary` + `btoa` first for the same
        // reason, see `sendPush` in src/webpush/webpush.ts.
        const payload = "hello, world - the quick brown fox jumps over";
        const { subscription, privateKey, authSecret } = await makeSubscriber();

        const encrypted = await encryptPayload(payload, subscription);

        const plain = await decryptPayload(
            encrypted.body,
            encrypted.salt,
            encrypted.dh,
            subscription,
            privateKey,
            authSecret,
        );
        expect(plain).toBe(payload);
    });

    it("exports helpers used in the HKDF chain", () => {
        // Guard the shape of exportPublicKeyPair so a regression there
        // (which breaks the Crypto-Key header + the shared-secret path)
        // is caught by this file instead of only by the round-trip.
        const jwk = {
            x: "qUPdEnG5oWe-RRLN1BDXrFW_W7_X9z5ckLuJ4XKR2x0",
            y: "sNfEWvxylINwJbbyFJPQ7p-U8_6PINqowuRBbgfm_mg",
        };
        const value = exportPublicKeyPair(jwk);
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
    });
});

/**
 * `sendPush` must trust the push service to the extent of the spec:
 *   - 2xx (200/201/204) is success and the device is kept;
 *   - 400/401/404/410 means the subscription is gone — the caller
 *     deletes the device;
 *   - anything else surfaces as `Error` so the caller can log it.
 */
describe("sendPush HTTP-status mapping", () => {
    const SUBSCRIPTION: WebPushData = {
        endpoint: "http://127.0.0.1:9/push-destination",
        key: "BLk+xYVGJ7Uew15f7riD2YOhRklJSkrqirpEzQP9zd9ctk2GUAh3H2B4RZsV4hwT3RiKv4saWq0VeV81ErZsw1M=",
        auth: "oyKCFMzRZ5qIBsIqU9b9kQ==",
    };

    const message = {
        data: '{"title":"t","message":"m"}',
        urgency: "normal" as const,
        sub: TEST_SUB,
        ttl: 60,
    };

    const applicationServerKeys = JSON.parse(atob(TEST_VAPID_KEY));

    const stubFetch = (status: number): typeof fetch => {
        return async () =>
            new Response(status === 204 ? null : "ok", { status });
    };

    for (const code of [200, 201, 204]) {
        it(`maps ${code} to Success`, async () => {
            const outcome = await sendPush(
                { message, deviceData: SUBSCRIPTION, applicationServerKeys },
                stubFetch(code),
            );
            expect(outcome.result).toBe(WebPushResult.Success);
            expect(outcome.status).toBe(code);
        });
    }

    for (const code of [400, 401, 404, 410]) {
        it(`maps ${code} to NotSubscribed`, async () => {
            const outcome = await sendPush(
                { message, deviceData: SUBSCRIPTION, applicationServerKeys },
                stubFetch(code),
            );
            expect(outcome.result).toBe(WebPushResult.NotSubscribed);
            expect(outcome.status).toBe(code);
        });
    }

    for (const code of [403, 500, 502, 503]) {
        it(`maps ${code} to Error`, async () => {
            const outcome = await sendPush(
                { message, deviceData: SUBSCRIPTION, applicationServerKeys },
                stubFetch(code),
            );
            expect(outcome.result).toBe(WebPushResult.Error);
            expect(outcome.status).toBe(code);
            expect(outcome.error).toBeInstanceOf(Error);
        });
    }

    it("surfaces network errors as Error", async () => {
        const outcome = await sendPush(
            { message, deviceData: SUBSCRIPTION, applicationServerKeys },
            async () => {
                throw new Error("boom");
            },
        );
        expect(outcome.result).toBe(WebPushResult.Error);
        expect(outcome.status).toBeUndefined();
        expect(outcome.error?.message).toBe("boom");
    });
});
