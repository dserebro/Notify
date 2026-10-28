import {
    failure,
    success,
    type WebPushData,
    WebPushDataSchema,
} from "@notify/shared";
import { type Context, Hono } from "hono";
import type { AppDeps, AppVariables } from "../app.js";
import { createDevice, deleteDevice, patchDevice } from "../logic/device.js";
import {
    validateDeviceSecret,
    validateUserLoginKey,
} from "../middleware/auth.js";

/**
 * `/api/device` sub-app. Shapes mirror the legacy backend:
 *   - `POST /`               → `success({ id, secret })`
 *   - `GET /:device_id`      → `success({ exists: true })`
 *   - `PATCH /:device_id`    → `success(true)`
 *   - `DELETE /:device_id`   → `success(true)`
 *
 * Decision-13 fixes:
 *   - PATCH no longer overwrites the device secret with the raw
 *     Authorization header; only `pushData` is updated.
 *   - An unknown device id returns 401 (handled by
 *     `validateDeviceSecret`), not 500.
 */
/**
 * Read `{ web_push_data }` from the JSON body and validate it. Returns
 * the parsed subscription, or the 400 `invalid_data` response that both
 * POST and PATCH send for a malformed body or subscription.
 */
async function parseWebPushBody(c: Context): Promise<WebPushData | Response> {
    const invalid = () =>
        c.json(failure("invalid_data", "invalid web_push_data"), 400, {
            "Cache-Control": "no-cache",
        });
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return invalid();
    }
    const subscription = (body as { web_push_data?: unknown })?.web_push_data;
    const parsed = WebPushDataSchema.safeParse(subscription);
    return parsed.success ? parsed.data : invalid();
}

export function createDeviceRoutes(deps: AppDeps) {
    const app = new Hono<{ Variables: AppVariables }>();

    app.post("/", validateUserLoginKey(deps), async (c) => {
        const pushData = await parseWebPushBody(c);
        if (pushData instanceof Response) {
            return pushData;
        }
        const device = createDevice(deps, pushData);
        return c.json(success({ id: device.id, secret: device.secret }), 200, {
            "Cache-Control": "no-cache",
        });
    });

    app.get("/:device_id", validateDeviceSecret(deps), (c) => {
        return c.json(success({ exists: true }), 200, {
            "Cache-Control": "no-cache",
        });
    });

    app.patch("/:device_id", validateDeviceSecret(deps), async (c) => {
        const device = c.get("device");
        const pushData = await parseWebPushBody(c);
        if (pushData instanceof Response) {
            return pushData;
        }
        patchDevice(deps, device, { pushData });
        return c.json(success(true), 200, {
            "Cache-Control": "no-cache",
        });
    });

    app.delete("/:device_id", validateDeviceSecret(deps), (c) => {
        const device = c.get("device");
        deleteDevice(deps, device);
        return c.json(success(true), 200, {
            "Cache-Control": "no-cache",
        });
    });

    // Legacy Oak returned 405 (with an empty body) when a method was
    // not implemented for an existing resource. Hono would otherwise
    // 404 for an unmatched method; the `all` catch-alls land after the
    // specific handlers so GET/POST/… still win on their own routes.
    app.all("/", (c) => c.body(null, 405));
    app.all("/:device_id", (c) => c.body(null, 405));

    return app;
}
