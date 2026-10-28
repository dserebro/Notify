import { describe, expect, it } from "vitest";
import type {
    ExtendedSubscription,
    ExtractedWebPushData,
} from "../../src/types/webpushdata";
import { encodeWebPushData, getWebPushData } from "../../src/util/webpushutil";

function keyBuffer(bytes: number[]): ArrayBuffer {
    return new Uint8Array(bytes).buffer;
}

/**
 * Minimal fake PushSubscription. The real object exposes a getKey() that
 * returns an ArrayBuffer (or null), plus `endpoint` and `expirationTime`.
 * webpushutil only touches those surfaces, so a plain object stand-in is
 * enough to exercise the production code paths.
 */
function fakeSubscription(opts: {
    endpoint?: string;
    p256dh?: ArrayBuffer | null;
    auth?: ArrayBuffer | null;
    expirationTime?: number | null;
}): ExtendedSubscription {
    const {
        endpoint = "https://push.example.com/x",
        p256dh = keyBuffer([1, 2, 3]),
        auth = keyBuffer([4, 5, 6]),
        expirationTime = undefined,
    } = opts;
    return {
        endpoint,
        expirationTime: expirationTime ?? undefined,
        getKey(name: string) {
            if (name === "p256dh") return p256dh;
            if (name === "auth") return auth;
            return null;
        },
    } as unknown as ExtendedSubscription;
}

describe("getWebPushData", () => {
    it("extracts endpoint, keys and expirationTime from a subscription", () => {
        const sub = fakeSubscription({
            endpoint: "https://push.example.com/abc",
            p256dh: keyBuffer([10, 20]),
            auth: keyBuffer([30, 40]),
            expirationTime: 42,
        });
        const out = getWebPushData(sub);
        expect(out.endpoint).toBe("https://push.example.com/abc");
        expect(new Uint8Array(out.key)).toEqual(new Uint8Array([10, 20]));
        expect(new Uint8Array(out.auth)).toEqual(new Uint8Array([30, 40]));
        expect(out.expirationTime).toBe(42);
    });

    it("throws when the p256dh key is missing", () => {
        const sub = fakeSubscription({ p256dh: null });
        expect(() => getWebPushData(sub)).toThrow(
            /Could not get subscription data/,
        );
    });

    it("throws when the auth secret is missing", () => {
        const sub = fakeSubscription({ auth: null });
        expect(() => getWebPushData(sub)).toThrow(
            /Could not get subscription data/,
        );
    });
});

describe("encodeWebPushData", () => {
    it("base64-encodes key and auth, preserving endpoint", () => {
        const data: ExtractedWebPushData = {
            endpoint: "https://push.example.com/abc",
            key: keyBuffer([104, 101, 108, 108, 111]), // "hello"
            auth: keyBuffer([119, 111, 114, 108, 100]), // "world"
        };
        const encoded = encodeWebPushData(data);
        expect(encoded.endpoint).toBe("https://push.example.com/abc");
        expect(encoded.key).toBe("aGVsbG8=");
        expect(encoded.auth).toBe("d29ybGQ=");
    });

    it("drops expirationTime from the wire shape (server only wants the triple)", () => {
        const data: ExtractedWebPushData = {
            endpoint: "https://push.example.com/abc",
            key: keyBuffer([1]),
            auth: keyBuffer([2]),
            expirationTime: 9999,
        };
        const encoded = encodeWebPushData(data) as Record<string, unknown>;
        expect(encoded).not.toHaveProperty("expirationTime");
        expect(Object.keys(encoded).sort()).toEqual([
            "auth",
            "endpoint",
            "key",
        ]);
    });
});
