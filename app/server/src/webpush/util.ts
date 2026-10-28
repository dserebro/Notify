import type { webcrypto } from "node:crypto";

// note:
// all util functions in this module return normal b64, NOT URL-safe b64.
// Use `b64ToUrlEncoded` to convert to URL-safe b64.
//
// NB: the UTF-16 binary codec (`toBinary` / `fromBinary`) deliberately
// lives in `@notify/shared` so the server and the service worker share
// one wire-format implementation. Do NOT re-define it here.

function arrayToHex(byteArray: Uint8Array): string {
    return Array.prototype.map
        .call(byteArray, (byte: number) => {
            return `0${(byte & 0xff).toString(16)}`.slice(-2);
        })
        .join("");
}

/**
 * Returns a lowercase-hex random id of length `size * 2`. The device
 * id/secret pair stored by the server uses `generateRandomId(16)` to
 * produce the 32-character hex strings the API contract exposes.
 */
export function generateRandomId(size = 16): string {
    const buffer = new Uint8Array(size);
    crypto.getRandomValues(buffer);
    return arrayToHex(buffer);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let bin = "";
    const uint8 = new Uint8Array(buffer);
    uint8.forEach((code: number) => {
        bin += String.fromCharCode(code);
    });
    return btoa(bin);
}

export function b64ToUrlEncoded(str: string): string {
    return str.replaceAll(/\+/g, "-").replaceAll(/\//g, "_").replace(/=+/g, "");
}

export function urlEncodedToB64(str: string): string {
    const padding = "=".repeat((4 - (str.length % 4)) % 4);
    return str.replaceAll(/-/g, "+").replaceAll(/_/g, "/") + padding;
}

export function stringToU8Array(str: string): Uint8Array {
    return new Uint8Array(str.split("").map((c) => c.charCodeAt(0)));
}

export function u8ToString(u8: Uint8Array): string {
    return String.fromCharCode.apply(null, u8 as unknown as number[]);
}

/**
 * Serialize a JWK's `x` / `y` coordinates as the uncompressed P-256
 * point `0x04 || x || y`, base64-encoded. The result still needs to go
 * through `b64ToUrlEncoded` before being included in a VAPID `k=` or
 * `dh=` header value.
 */
export function exportPublicKeyPair<T extends { x: string; y: string }>(
    key: T,
): string {
    return btoa(
        `\x04${atob(urlEncodedToB64(key.x))}${atob(urlEncodedToB64(key.y))}`,
    );
}

export function joinUint8Arrays(allUint8Arrays: Array<Uint8Array>): Uint8Array {
    return allUint8Arrays.reduce((cumulativeValue, nextValue) => {
        const joinedArray = new Uint8Array(
            cumulativeValue.byteLength + nextValue.byteLength,
        );
        joinedArray.set(cumulativeValue, 0);
        joinedArray.set(nextValue, cumulativeValue.byteLength);
        return joinedArray;
    }, new Uint8Array());
}

function base64UrlToUint8Array(base64UrlData: string): Uint8Array {
    const base64 = urlEncodedToB64(base64UrlData);
    const rawData = atob(base64);
    return stringToU8Array(rawData);
}

/**
 * Export the raw uncompressed P-256 public key (and optionally the raw
 * private scalar) as Uint8Arrays. The public key is the 65-byte
 * `0x04 || x || y` form expected by the HKDF context in `message.ts`.
 */
export async function cryptoKeysToUint8Array(
    pubKey: webcrypto.CryptoKey,
    privKey?: webcrypto.CryptoKey,
): Promise<{ publicKey: Uint8Array; privateKey?: Uint8Array }> {
    const jwk = await crypto.subtle.exportKey("jwk", pubKey);
    const x = base64UrlToUint8Array(jwk.x as string);
    const y = base64UrlToUint8Array(jwk.y as string);
    const publicKey = new Uint8Array(65);
    publicKey.set([0x04], 0);
    publicKey.set(x, 1);
    publicKey.set(y, 33);
    if (privKey) {
        const privJwk = await crypto.subtle.exportKey("jwk", privKey);
        const privateKey = base64UrlToUint8Array(privJwk.d as string);
        return { publicKey, privateKey };
    }
    return { publicKey };
}
