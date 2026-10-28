import { timingSafeEqual } from "node:crypto";
import { failure } from "@notify/shared";
import type { MiddlewareHandler } from "hono";
import type { AppDeps, AppVariables } from "../app.js";

/**
 * Three auth middleware factories matching the legacy
 * `app/backend/middleware/auth.ts` behavior, with two decision-13
 * fixes:
 *   - `validateDeviceSecret` returns 401 when the device id is unknown
 *     (legacy let the "not found" exception escape as a 500);
 *   - the compare is `timingSafeEqual` rather than a hand-rolled loop,
 *     which cannot leak length through branch prediction.
 */

/**
 * Constant-time string equality. Returns false early when lengths
 * differ (that is not secret information for our use — tokens are
 * fixed-length) and otherwise defers to `crypto.timingSafeEqual`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) {
        return false;
    }
    return timingSafeEqual(aBuf, bBuf);
}

/**
 * Pull a bearer token from an `Authorization` header. Returns null for
 * missing header, wrong scheme, or empty token — the three cases the
 * legacy `validateAuthHeader` rejected before comparing the secret.
 */
export function parseBearer(authHeader: string | undefined | null): string | null {
    if (!authHeader) {
        return null;
    }
    const [scheme, token] = authHeader.split(" ");
    if (!scheme || scheme.toLowerCase() !== "bearer") {
        return null;
    }
    if (!token) {
        return null;
    }
    return token;
}

/** Shared 401 reply. Matches the legacy body and headers. */
function authFailure(c: Parameters<MiddlewareHandler>[0]) {
    return c.json(
        failure("auth_required", "Authorization header invalid"),
        401,
        { "Cache-Control": "no-cache" },
    );
}

/**
 * Guard `POST /api/device`. If `LOGINKEY` is not configured, every
 * caller is allowed through (matches legacy behaviour so public demo
 * deployments keep working). Otherwise the bearer token must match in
 * constant time.
 */
export function validateUserLoginKey(
    deps: AppDeps,
): MiddlewareHandler<{ Variables: AppVariables }> {
    return async (c, next) => {
        const expected = deps.config.loginkey;
        if (!expected) {
            await next();
            return;
        }
        const token = parseBearer(c.req.header("authorization") ?? null);
        if (!token || !constantTimeEqual(token, expected)) {
            return authFailure(c);
        }
        await next();
        return;
    };
}

/**
 * Guard the per-device endpoints. The bearer token must equal the
 * stored secret for the id in `:device_id`. On success the device is
 * published through `c.set("device", ...)` so the handler does not
 * refetch it.
 *
 * Decision-13 fix: an unknown device id returns 401, not 500 (the
 * legacy let `databaseGetDevice`'s not-found exception escape).
 */
export function validateDeviceSecret(
    deps: AppDeps,
): MiddlewareHandler<{ Variables: AppVariables }> {
    return async (c, next) => {
        const token = parseBearer(c.req.header("authorization") ?? null);
        if (!token) {
            return authFailure(c);
        }
        const deviceId = c.req.param("device_id");
        if (!deviceId || !deps.repository.exists(deviceId)) {
            return authFailure(c);
        }
        const device = deps.repository.get(deviceId);
        if (!device || !constantTimeEqual(token, device.secret)) {
            return authFailure(c);
        }
        c.set("device", device);
        await next();
        return;
    };
}

/**
 * Guard `POST /api/notify`. If `SENDKEY` is not configured, every
 * caller is allowed through (matches legacy). Otherwise the bearer
 * token must match in constant time.
 */
export function validatePushSecret(
    deps: AppDeps,
): MiddlewareHandler<{ Variables: AppVariables }> {
    return async (c, next) => {
        const expected = deps.config.sendkey;
        if (!expected) {
            await next();
            return;
        }
        const token = parseBearer(c.req.header("authorization") ?? null);
        if (!token || !constantTimeEqual(token, expected)) {
            return authFailure(c);
        }
        await next();
        return;
    };
}
