import type { webcrypto } from "node:crypto";

/**
 * HKDF (RFC 5869) specialised for the Web Push `aesgcm` content
 * encryption step (RFC 8188 / draft-ietf-webpush-encryption-04). The
 * implementation is a single-block HKDF — info is appended with the
 * fixed `0x01` counter, as the derived material never exceeds HMAC-
 * SHA-256's output length. Ported verbatim from
 * `app/backend/webpush/hkdf.ts`.
 */

export async function hmacSign(
    ikm: Uint8Array | ArrayBuffer,
    input: ArrayBuffer,
): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
        "raw",
        ikm as webcrypto.BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return await crypto.subtle.sign("HMAC", key, input);
}

export async function hkdfGenerate(
    ikm: ArrayBuffer,
    salt: Uint8Array,
    info: Uint8Array,
    byteLength: number,
): Promise<ArrayBuffer> {
    const fullInfoBuffer = new Uint8Array(info.byteLength + 1);
    fullInfoBuffer.set(info, 0);
    fullInfoBuffer.set(new Uint8Array(1).fill(1), info.byteLength);
    const prk = await hmacSign(salt, ikm);
    const nextPrk = await hmacSign(prk, fullInfoBuffer.buffer as ArrayBuffer);
    return nextPrk.slice(0, byteLength);
}
