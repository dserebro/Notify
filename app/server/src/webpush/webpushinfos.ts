import type { Urgency, WebPushData } from "@notify/shared";
import type { JWK } from "./jwk.js";

/**
 * Internal push-send primitives used only inside `webpush/`.
 *
 * The `WebPushData` subscription shape (`endpoint` / `key` / `auth`) is
 * imported from `@notify/shared` so the server and the frontend agree
 * on one Zod schema. The `WebPushMessage` and `WebPushParameters`
 * records below are server-local: they describe the message content
 * and the full argument bundle `sendPush` consumes.
 */

export interface WebPushMessage {
    /** Already-serialized payload (JSON string the SW will decode). */
    data: string;
    urgency: Urgency;
    /** VAPID subject (mailto:/https: URL). */
    sub: string;
    /** TTL in seconds, forwarded to the push service. */
    ttl: number;
}

export interface WebPushParameters {
    message: WebPushMessage;
    deviceData: WebPushData;
    applicationServerKeys: JWK;
}
