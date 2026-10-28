import { z } from "zod";

/**
 * Standard (non URL-safe) base64 pattern, matching the legacy
 * `WebPushInfosSchema` in `app/backend/webpush/webpushinfos.ts`.
 * The device-registration flow sends `key`/`auth` as base64 strings
 * extracted from `PushSubscription.getKey(...)` on the client.
 */
const base64Regex =
    /^(?:[a-zA-Z0-9+/]{4})*(?:|(?:[a-zA-Z0-9+/]{3}=)|(?:[a-zA-Z0-9+/]{2}==)|(?:[a-zA-Z0-9+/]{1}===))$/;

/**
 * Zod schema for a Web Push subscription descriptor stored on a
 * device: the push service endpoint plus the two base64 keys needed
 * to encrypt and authenticate payloads. Field caps mirror the legacy
 * schema so already-registered devices continue to validate.
 */
export const WebPushDataSchema = z.object({
    endpoint: z.string().url().max(1024),
    key: z.string().max(512).regex(base64Regex, "key is not base64 encoded"),
    auth: z.string().max(256).regex(base64Regex, "auth is not base64 encoded"),
});

export type WebPushData = z.infer<typeof WebPushDataSchema>;

/**
 * Urgency hint passed to the push service. Matches the legacy
 * `Urgency` union in `webpush/webpushinfos.ts`.
 */
export const UrgencySchema = z.enum(["very-low", "low", "normal", "high"]);
export type Urgency = z.infer<typeof UrgencySchema>;

/**
 * Outcome of a single push attempt, used by the server's fan-out
 * logic. `NotSubscribed` triggers device cleanup (400/401/404/410 →
 * delete), per the legacy mapping.
 */
export enum WebPushResult {
    Success = 0,
    Error = 1,
    NotSubscribed = 2,
}
