import { describe, it, expect, vi, afterEach } from "vitest";
import { hmacSign, hkdfGenerate } from "../src/webpush/hkdf";
import { generateAESGCMEncryptedMessage, generateContext, generateEncryptionKeys } from "../src/webpush/message";
import { sendWebPushMessage } from "../src/webpush/webpush";
import { WebPushResult } from "../src/webpush/webpushinfos";

async function buildSubscription() {
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
    ) as unknown as { publicKey: CryptoKey; privateKey: CryptoKey };

    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey) as any;

    function urlDecodeB64(s: string): string {
        const padding = "=".repeat((4 - (s.length % 4)) % 4);
        return s.replace(/-/g, "+").replace(/_/g, "/") + padding;
    }

    const x = Uint8Array.from(atob(urlDecodeB64(jwk.x)), c => c.charCodeAt(0));
    const y = Uint8Array.from(atob(urlDecodeB64(jwk.y)), c => c.charCodeAt(0));
    const pub = new Uint8Array(65);
    pub[0] = 0x04;
    pub.set(x, 1);
    pub.set(y, 33);

    const auth = crypto.getRandomValues(new Uint8Array(16));

    return {
        endpoint: "https://push.example.com/send/test",
        key: btoa(String.fromCharCode(...pub)),
        auth: btoa(String.fromCharCode(...auth)),
    };
}

async function buildServerKeys() {
    return await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"]
    ) as unknown as { publicKey: CryptoKey; privateKey: CryptoKey };
}

const testJwk = {
    kty: "EC", crv: "P-256", alg: "ES256",
    x: "Q_vZUWPLNRQLFu9AdMhdCBQicQJjlXj5Ggipc_AKQ9Q",
    y: "H-yCP_agqsFjF2h-ggMM7UOU1vKI7RSqMWIX_f0IzHg",
    d: "5Ww85Nqq7OecJrh3y09zkRKYdwLHTU5Nn9MeCj2Hzcc",
    key_ops: ["sign"], ext: true,
};

describe("hmacSign", () => {
    it("returns a 32-byte HMAC-SHA-256 output", async () => {
        const ikm = new Uint8Array(32).fill(0xaa);
        const input = new Uint8Array(16).fill(0xbb);
        const result = await hmacSign(ikm, input);
        expect(result.byteLength).toBe(32);
    });

    it("is deterministic for the same key and input", async () => {
        const ikm = new Uint8Array(32).fill(0x55);
        const input = new Uint8Array([0x01, 0x02]);
        const out1 = await hmacSign(ikm, input);
        const out2 = await hmacSign(ikm, input);
        expect(new Uint8Array(out1)).toEqual(new Uint8Array(out2));
    });

    it("produces different output for different inputs", async () => {
        const ikm = new Uint8Array(32).fill(0x01);
        const out1 = await hmacSign(ikm, new Uint8Array([1, 2, 3]));
        const out2 = await hmacSign(ikm, new Uint8Array([4, 5, 6]));
        expect(new Uint8Array(out1)).not.toEqual(new Uint8Array(out2));
    });
});

describe("hkdfGenerate", () => {
    it("returns the requested number of bytes (16 — CEK size)", async () => {
        const ikm = new Uint8Array(32).fill(0x01).buffer;
        const salt = new Uint8Array(32).fill(0x02);
        const info = new Uint8Array([0x03]);
        const result = await hkdfGenerate(ikm, salt, info, 16);
        expect(result.byteLength).toBe(16);
    });

    it("returns the requested number of bytes (12 — nonce size)", async () => {
        const ikm = new Uint8Array(32).fill(0x01).buffer;
        const salt = new Uint8Array(32).fill(0x02);
        const info = new Uint8Array([0x03]);
        const result = await hkdfGenerate(ikm, salt, info, 12);
        expect(result.byteLength).toBe(12);
    });

    it("produces different output for different salts", async () => {
        const ikm = new Uint8Array(32).fill(0x01).buffer;
        const info = new Uint8Array([0x03]);
        const out1 = await hkdfGenerate(ikm, new Uint8Array(32).fill(0x02), info, 16);
        const out2 = await hkdfGenerate(ikm, new Uint8Array(32).fill(0x03), info, 16);
        expect(new Uint8Array(out1)).not.toEqual(new Uint8Array(out2));
    });
});

describe("generateContext", () => {
    it("returns a Uint8Array of 140 bytes", async () => {
        const subscription = await buildSubscription();
        const serverKeys = await buildServerKeys();
        const context = await generateContext(subscription, serverKeys);
        expect(context).toBeInstanceOf(Uint8Array);
        expect(context.byteLength).toBe(140);
    });

    it("starts with the P-256 label followed by a null byte", async () => {
        const subscription = await buildSubscription();
        const serverKeys = await buildServerKeys();
        const context = await generateContext(subscription, serverKeys);
        const label = Array.from(context.slice(0, 6))
            .map(b => String.fromCharCode(b))
            .join("");
        expect(label).toBe("P-256\x00");
    });
});

describe("generateEncryptionKeys", () => {
    it("returns a 16-byte CEK and a 12-byte nonce", async () => {
        const subscription = await buildSubscription();
        const serverKeys = await buildServerKeys();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const { contentEncryptionKey, nonce } = await generateEncryptionKeys(subscription, salt, serverKeys);
        expect(contentEncryptionKey.byteLength).toBe(16);
        expect(nonce.byteLength).toBe(12);
    });
});

describe("generateAESGCMEncryptedMessage", () => {
    it("returns cipherText, salt, and publicServerKey", async () => {
        const subscription = await buildSubscription();
        const result = await generateAESGCMEncryptedMessage("hello", subscription);
        expect(result.cipherText).toBeInstanceOf(ArrayBuffer);
        expect(typeof result.salt).toBe("string");
        expect(typeof result.publicServerKey).toBe("string");
    });

    it("salt and publicServerKey are URL-safe base64", async () => {
        const subscription = await buildSubscription();
        const result = await generateAESGCMEncryptedMessage("test payload", subscription);
        expect(result.salt).not.toMatch(/[+/=]/);
        expect(result.publicServerKey).not.toMatch(/[+/=]/);
    });

    it("cipherText is larger than the plaintext due to padding and GCM tag", async () => {
        const subscription = await buildSubscription();
        const payload = "hello world";
        const result = await generateAESGCMEncryptedMessage(payload, subscription);
        expect(result.cipherText.byteLength).toBeGreaterThan(payload.length);
    });
});

describe("sendWebPushMessage", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const message = { data: "hello", urgency: "normal" as const, sub: "mailto:test@example.com", ttl: 60 };

    it("returns Success for 201 response", async () => {
        vi.stubGlobal("fetch", async () => new Response(null, { status: 201 }));
        const sub = await buildSubscription();
        expect(await sendWebPushMessage(message, sub, testJwk)).toBe(WebPushResult.Success);
    });

    it("returns NotSubscribed for 410 response", async () => {
        vi.stubGlobal("fetch", async () => new Response(null, { status: 410 }));
        const sub = await buildSubscription();
        expect(await sendWebPushMessage(message, sub, testJwk)).toBe(WebPushResult.NotSubscribed);
    });

    it("returns Error for unexpected status", async () => {
        vi.stubGlobal("fetch", async () => new Response("server error", { status: 500 }));
        const sub = await buildSubscription();
        expect(await sendWebPushMessage(message, sub, testJwk)).toBe(WebPushResult.Error);
    });

    it("sends required encryption and VAPID headers", async () => {
        let capturedHeaders: Record<string, string> = {};
        vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
            capturedHeaders = { ...(init?.headers as Record<string, string>) };
            return new Response(null, { status: 201 });
        });
        const sub = await buildSubscription();
        await sendWebPushMessage(
            { data: "test", urgency: "high", sub: "mailto:test@example.com", ttl: 86400 },
            sub,
            testJwk
        );
        expect(capturedHeaders["Content-Encoding"]).toBe("aesgcm");
        expect(capturedHeaders["Content-Type"]).toBe("application/octet-stream");
        expect(capturedHeaders["TTL"]).toBe("86400");
        expect(capturedHeaders["Urgency"]).toBe("high");
        expect(capturedHeaders["Encryption"]).toMatch(/^salt=/);
        expect(capturedHeaders["Crypto-Key"]).toMatch(/^dh=.+/);
        expect(capturedHeaders["Authorization"]).toMatch(/^vapid t=.+, k=.+$/);
    });
});
