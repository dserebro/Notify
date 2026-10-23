import { Hono } from "hono";
import type { Env } from "../types/env";
import { success, failure } from "../types/apiresponse";
import type { JWK } from "../webpush/jwk";
import { b64ToUrlEncoded, exportPublicKeyPair } from "../webpush/util";

const keys = new Hono<{ Bindings: Env }>();

keys.get("/", (c) => {
    try {
        const vapid = atob(c.env.VAPID_KEY);
        const vapidKeys: Readonly<JWK> = JSON.parse(vapid);
        const publicKey: string = b64ToUrlEncoded(exportPublicKeyPair(vapidKeys));
        return success(publicKey);
    } catch (error) {
        return failure({ type: "internal_error", message: (error as Error).message });
    }
});

keys.get("/auth", (c) => {
    try {
        const loginkey = c.env.LOGINKEY;
        return success(Boolean(loginkey));
    } catch (error) {
        return failure({ type: "internal_error", message: (error as Error).message });
    }
});

export { keys as keysRouter };
