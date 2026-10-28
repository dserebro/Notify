import { toBinary, WebPushResult } from "@notify/shared";
import { generateAESGCMEncryptedMessage } from "./message.js";
import { generateV2Headers } from "./vapid.js";
import type { WebPushParameters } from "./webpushinfos.js";

/**
 * Send one encrypted Web Push message to a single device.
 *
 * Behavior is byte-identical to the legacy
 * `app/backend/webpush/webpush.ts`:
 * - the UTF-16 binary payload is base64-encoded (`btoa(toBinary(...))`)
 *   before encryption, so the service worker's `fromBinary(atob(...))`
 *   path keeps decoding it;
 * - the request carries the VAPID v2 `Authorization: vapid t=…, k=…`
 *   header, `Encryption: salt=…`, `Crypto-Key: dh=…`,
 *   `Content-Encoding: aesgcm`, `Content-Type: application/octet-stream`,
 *   `TTL` and `Urgency`;
 * - status mapping: 200/201/204 → `Success`;
 *   400/401/404/410 → `NotSubscribed` (caller deletes the device);
 *   any other status (or a thrown error) → `Error`.
 *
 * Two things change from the Deno version:
 * 1. `fetchImpl` is injectable so API tests can stub the push service
 *    without network. It defaults to `globalThis.fetch`.
 * 2. The function returns a result bundle (`{ result, error, status }`)
 *    instead of just a `WebPushResult`, so the caller can log the
 *    underlying cause of an `Error` without this module calling
 *    `console.error` directly.
 */
export interface SendPushOutcome {
    result: WebPushResult;
    /** HTTP status when the request completed; undefined on throw. */
    status?: number;
    /** Underlying error for `WebPushResult.Error`. */
    error?: Error;
}

export async function sendPush(
    params: WebPushParameters,
    fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SendPushOutcome> {
    const { message, deviceData, applicationServerKeys } = params;

    try {
        const binString = toBinary(message.data);
        const dataB64 = btoa(binString);

        const [authHeaders, encryptedPayloadDetails] = await Promise.all([
            generateV2Headers(
                deviceData.endpoint,
                applicationServerKeys,
                message.sub,
            ),
            generateAESGCMEncryptedMessage(dataB64, deviceData),
        ]);

        const headers: { [headerName: string]: string } = { ...authHeaders };

        headers.Encryption = `salt=${encryptedPayloadDetails.salt}`;
        headers["Crypto-Key"] = `dh=${encryptedPayloadDetails.publicServerKey}`;
        headers["Content-Encoding"] = "aesgcm";
        headers["Content-Type"] = "application/octet-stream";

        // setup message headers
        headers.TTL = `${message.ttl}`;
        headers.Urgency = `${message.urgency}`;

        const res = await fetchImpl(deviceData.endpoint, {
            method: "POST",
            headers,
            body: encryptedPayloadDetails.cipherText,
        });

        switch (res.status) {
            case 200: // http ok
            case 201: // http created
            case 204: // http no content
                return { result: WebPushResult.Success, status: res.status };

            case 400: // http bad request
            case 401: // http unauthorized
            case 404: // http not found
            case 410: // http gone
                return {
                    result: WebPushResult.NotSubscribed,
                    status: res.status,
                };
        }

        const body = await res.text().catch(() => "");
        return {
            result: WebPushResult.Error,
            status: res.status,
            error: new Error(`Web Push error: ${res.status} body: ${body}`),
        };
    } catch (err) {
        return {
            result: WebPushResult.Error,
            error: err instanceof Error ? err : new Error(String(err)),
        };
    }
}
