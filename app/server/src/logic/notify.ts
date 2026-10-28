import { type Message, WebPushResult } from "@notify/shared";
import type { AppDeps } from "../app.js";
import type { JWK } from "../webpush/jwk.js";
import { sendPush } from "../webpush/webpush.js";

/**
 * Aggregate counts returned by `notifyAll`. Used by the caller for one
 * summary log line per fan-out; per-device detail is logged inside
 * this function.
 */
export type NotifyStats = {
    total: number;
    sent: number;
    failed: number;
    removed: number;
};

/**
 * Fan an already-validated `Message` out to every registered device.
 *
 * Behavior preserved from `app/backend/logic/project/notify.ts`:
 *   - a single `listAll()` is used (the legacy backend did a listing
 *     plus one `databaseGetDevice` per id, which is N+1);
 *   - stale devices (`WebPushResult.NotSubscribed`, mapped from
 *     400/401/404/410 push-service responses) are deleted;
 *   - the serialized JSON payload is passed to `sendPush`, which
 *     re-encodes it via `toBinary` + `btoa` so the service worker's
 *     `fromBinary(atob(...))` path keeps working;
 *   - `urgency: "normal"` and `ttl: 60 * 24 * 7` match the legacy.
 *
 * Decision-13 fix: per-device failures are logged with
 * `deps.logger.warn("push failed", { id, error, status })`, so
 * `Promise.allSettled` no longer swallows them silently.
 */
export async function notifyAll(
    deps: AppDeps,
    message: Message,
): Promise<NotifyStats> {
    const applicationServerKeys = JSON.parse(
        atob(deps.config.vapidKey),
    ) as JWK;
    const serialized = JSON.stringify(message);
    const devices = deps.repository.listAll();

    const results = await Promise.allSettled(
        devices.map(async (device) => {
            const outcome = await sendPush(
                {
                    message: {
                        data: serialized,
                        urgency: "normal",
                        sub: deps.config.sub,
                        ttl: 60 * 24 * 7,
                    },
                    deviceData: device.pushData,
                    applicationServerKeys,
                },
                deps.fetch,
            );

            if (outcome.result === WebPushResult.NotSubscribed) {
                deps.repository.delete(device.id);
            } else if (outcome.result === WebPushResult.Error) {
                deps.logger.warn("push failed", {
                    id: device.id,
                    error: outcome.error?.message,
                    status: outcome.status,
                });
            }

            return outcome;
        }),
    );

    let sent = 0;
    let failed = 0;
    let removed = 0;
    for (const r of results) {
        if (r.status === "rejected") {
            // Unexpected: sendPush should trap errors internally.
            failed += 1;
            deps.logger.warn("push failed", {
                error:
                    r.reason instanceof Error
                        ? r.reason.message
                        : String(r.reason),
            });
            continue;
        }
        switch (r.value.result) {
            case WebPushResult.Success:
                sent += 1;
                break;
            case WebPushResult.NotSubscribed:
                removed += 1;
                break;
            case WebPushResult.Error:
                failed += 1;
                break;
        }
    }

    return { total: devices.length, sent, failed, removed };
}
