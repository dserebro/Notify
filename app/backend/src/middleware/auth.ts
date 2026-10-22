import { Context, Next } from "hono";
import type { Env } from "../types/env";
import { failure } from "../types/apiresponse";
import { compareStringSafe } from "../util/crypto";
import { databaseGetDevice } from "../databases/device";

function validateAuthHeader(authHeader: string | null | undefined, key: string): boolean {
    if (!authHeader) {
        return false;
    }
    const [type, token] = authHeader.split(" ");
    if (type.toLowerCase() !== "bearer") {
        return false;
    }
    if (!token || !compareStringSafe(token, key)) {
        return false;
    }
    return true;
}

export async function validateUserLoginKey(c: Context<{ Bindings: Env }>, next: Next) {
    const loginkey = c.env.LOGINKEY;
    const authHeader = c.req.header("authorization");
    if (!loginkey || validateAuthHeader(authHeader, loginkey)) {
        return next();
    }
    return failure({ type: "auth_required", message: "Authorization header invalid" }, { status: 401 });
}

export async function validateDeviceSecret(c: Context<{ Bindings: Env }>, next: Next) {
    const authHeader = c.req.header("authorization");
    const deviceId = c.req.param("device_id");
    try {
        const device = await databaseGetDevice(c.env.DEVICES, deviceId);
        if (device && validateAuthHeader(authHeader, device.secret)) {
            return next();
        }
    } catch {
        // Device not found
    }
    return failure({ type: "auth_required", message: "Authorization header invalid" }, { status: 401 });
}

export async function validatePushSecret(c: Context<{ Bindings: Env }>, next: Next) {
    const sendkey = c.env.SENDKEY;
    const authHeader = c.req.header("authorization");
    if (!sendkey || validateAuthHeader(authHeader, sendkey)) {
        return next();
    }
    return failure({ type: "auth_required", message: "Authorization header invalid" }, { status: 401 });
}
