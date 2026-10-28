/**
 * Public surface of the ported Web Push module.
 *
 * The actual aesgcm / HKDF / VAPID machinery lives in the sibling
 * modules (`vapid.ts`, `message.ts`, `hkdf.ts`, `util.ts`). This
 * barrel re-exports what the rest of the server (routes, logic layer,
 * tests) actually needs; everything else stays module-private.
 */

export type { JWK } from "./jwk.js";
export { encryptPayload, generateAESGCMEncryptedMessage } from "./message.js";
export { generateRandomId } from "./util.js";
export {
    generateV1Headers,
    generateV2Headers,
    generateVapidJwt,
} from "./vapid.js";
export { type SendPushOutcome, sendPush } from "./webpush.js";
export type {
    WebPushMessage,
    WebPushParameters,
} from "./webpushinfos.js";
