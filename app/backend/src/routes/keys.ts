import { Hono } from "hono";
import type { Env } from "../types/env";
import { success } from "../types/apiresponse";
import type { JWK } from "../webpush/jwk";
import { b64ToUrlEncoded, exportPublicKeyPair } from "../webpush/util";

const keys = new Hono<{ Bindings: Env }>();

keys.get("/", (c) => {
    const vapid = atob(c.env.VAPID_KEY);
    const vapidKeys: Readonly<JWK> = JSON.parse(vapid);
    const publicKey: string = b64ToUrlEncoded(exportPublicKeyPair(vapidKeys));
    return success(publicKey);
});

keys.get("/auth", (c) => {
    const loginkey = c.env.LOGINKEY;
    return success(Boolean(loginkey));
});

export { keys as keysRouter };
