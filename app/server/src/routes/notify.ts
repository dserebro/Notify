import {
    enforceMessageSize,
    failure,
    MessageSchema,
    success,
} from "@notify/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import { notifyAll } from "../logic/notify.js";
import { validatePushSecret } from "../middleware/auth.js";

/**
 * `POST /api/notify` — the fan-out endpoint. Parses and size-checks
 * the body, delegates to `notifyAll` for the per-device dispatch, and
 * returns the legacy `success({ message: "notified" })` envelope.
 *
 * Per-device errors are logged by `notifyAll` (decision-13 fix) and
 * never surface in the API response. The 2048-byte limit from the
 * legacy backend is preserved via `enforceMessageSize`.
 */
export function createNotifyRoutes(deps: AppDeps) {
    const app = new Hono();

    app.post("/", validatePushSecret(deps), async (c) => {
        let raw: unknown;
        try {
            raw = await c.req.json();
        } catch {
            return c.json(failure("invalid_data", "invalid message"), 400);
        }

        const parsed = MessageSchema.safeParse(raw);
        if (!parsed.success) {
            return c.json(failure("invalid_data", "invalid message"), 400);
        }

        const serialized = JSON.stringify(parsed.data);
        if (!enforceMessageSize(serialized)) {
            return c.json(failure("invalid_data", "data too long"), 400);
        }

        const stats = await notifyAll(deps, parsed.data);
        deps.logger.info("notify dispatched", stats);

        return c.json(success({ message: "notified" }), 200);
    });

    // Oak returned 405 for non-POST requests to `/api/notify`. The
    // `all` catch lands after the POST handler, so POST still wins.
    app.all("/", (c) => c.body(null, 405));

    return app;
}
