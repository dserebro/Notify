import { success } from "@notify/shared";
import { Hono } from "hono";
import type { AppDeps } from "../app.js";
import type { JWK } from "../webpush/jwk.js";
import { b64ToUrlEncoded, exportPublicKeyPair } from "../webpush/util.js";

/**
 * `GET /api/keys` — returns the base64url(uncompressed P-256) public
 * component of the server's VAPID key. The browser passes this to
 * `pushManager.subscribe({ applicationServerKey })`.
 *
 * `GET /api/keys/auth` — returns `true`/`false` for whether a login
 * key is required to call `POST /api/device`. The legacy backend
 * returns the raw boolean (`success(Boolean(loginkey))`); the shape is
 * preserved so existing frontend code keeps working.
 */
export function createKeysRoutes(deps: AppDeps) {
    const app = new Hono();

    app.get("/", (c) => {
        const vapid = atob(deps.config.vapidKey);
        const vapidKeys = JSON.parse(vapid) as JWK;
        const publicKey = b64ToUrlEncoded(exportPublicKeyPair(vapidKeys));
        return c.json(success(publicKey), 200, {
            "Cache-Control": "no-cache",
        });
    });

    app.get("/auth", (c) => {
        return c.json(success(Boolean(deps.config.loginkey)), 200, {
            "Cache-Control": "no-cache",
        });
    });

    // Oak returned 405 for non-GET requests to `/api/keys` and
    // `/api/keys/auth`. The `all` catches land after the GET handlers,
    // so GET still wins; other methods fall through to 405.
    app.all("/", (c) => c.body(null, 405));
    app.all("/auth", (c) => c.body(null, 405));

    return app;
}
