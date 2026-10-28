import type { webcrypto } from "node:crypto";
import type { JWK } from "./jwk.js";
import {
    arrayBufferToBase64,
    b64ToUrlEncoded,
    exportPublicKeyPair,
    stringToU8Array,
} from "./util.js";

/**
 * VAPID (RFC 8292) ES256 JWT signer. Ported from
 * `app/backend/webpush/vapid.ts`:
 * - the token header is `{typ:"JWT", alg:"ES256"}`;
 * - the body carries `aud` / `exp` (12 h) / `sub`;
 * - the signature is a P-256 ECDSA over SHA-256 of
 *   `base64url(header).base64url(body)`;
 * - the v2 header value is `vapid t=<token>, k=<serverKey>`.
 *
 * The base64(JWK) private key format is preserved so already-registered
 * browsers (subscribed under this VAPID key) keep receiving pushes.
 */

const objToUrlB64 = (obj: { [key: string]: string | number | null }) =>
    b64ToUrlEncoded(btoa(JSON.stringify(obj)));

async function signData(token: string, applicationKeys: JWK): Promise<string> {
    const key = await crypto.subtle.importKey(
        "jwk",
        applicationKeys as unknown as webcrypto.JsonWebKey,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
    );

    const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        key,
        stringToU8Array(token) as webcrypto.BufferSource,
    );

    return b64ToUrlEncoded(arrayBufferToBase64(sig));
}

async function generateHeaders(
    endpoint: string,
    applicationServerKeys: JWK,
    sub: string,
): Promise<{ token: string; serverKey: string }> {
    const serverKey = b64ToUrlEncoded(
        exportPublicKeyPair(applicationServerKeys),
    );
    const pushService = new URL(endpoint);

    const header = {
        typ: "JWT",
        alg: "ES256",
    };

    const body = {
        aud: `${pushService.protocol}//${pushService.host}`,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: String(sub),
    };

    const unsignedToken = `${objToUrlB64(header)}.${objToUrlB64(body)}`;
    const signature = await signData(unsignedToken, applicationServerKeys);
    const token = `${unsignedToken}.${signature}`;
    return { token, serverKey };
}

export async function generateV1Headers(
    endpoint: string,
    applicationServerKeys: JWK,
    sub: string,
): Promise<{ [headerName in "Crypto-Key" | "Authorization"]: string }> {
    const headers = await generateHeaders(endpoint, applicationServerKeys, sub);
    return {
        Authorization: `WebPush ${headers.token}`,
        "Crypto-Key": `p256ecdsa=${headers.serverKey}`,
    };
}

export async function generateV2Headers(
    endpoint: string,
    applicationServerKeys: JWK,
    sub: string,
): Promise<{ [headerName in "Authorization"]: string }> {
    const headers = await generateHeaders(endpoint, applicationServerKeys, sub);
    return {
        Authorization: `vapid t=${headers.token}, k=${headers.serverKey}`,
    };
}

/**
 * Public-facing VAPID JWT helper used by callers that need the raw
 * token and the corresponding uncompressed public key (base64url).
 * `audience` is used verbatim as the JWT `aud` claim, so callers may
 * pass either a push endpoint or the already-reduced origin
 * (`https://fcm.googleapis.com`).
 */
export async function generateVapidJwt(
    subject: string,
    audience: string,
    vapidKey: string,
): Promise<{ token: string; publicKey: string }> {
    const applicationServerKeys = JSON.parse(atob(vapidKey)) as JWK;
    const headers = await generateHeaders(
        audience,
        applicationServerKeys,
        subject,
    );
    return { token: headers.token, publicKey: headers.serverKey };
}
