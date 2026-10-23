import { databaseGetAllDeviceIDs, databaseGetDevice } from "../../databases/device";
import type { JWK } from "../../webpush/jwk";
import { sendWebPushMessage } from "../../webpush/webpush";
import { WebPushMessage, WebPushResult } from "../../webpush/webpushinfos";
import { deleteDevice } from "../device/delete";

export async function notifyAll(kv: KVNamespace, vapidKey: string, sub: string, data: string): Promise<Promise<unknown>> {
    const vapidKeys: Readonly<JWK> = JSON.parse(vapidKey);
    const webPushMessageInfo: WebPushMessage = {
        data: String(data),
        urgency: "normal",
        sub: sub,
        ttl: 60 * 24 * 7,
    };

    const deviceIds = await databaseGetAllDeviceIDs(kv);
    const promises = deviceIds.map(async (deviceId): Promise<WebPushResult> => {
        const device = await databaseGetDevice(kv, deviceId);
        const result = await sendWebPushMessage(webPushMessageInfo, device.pushData, vapidKeys);
        if (result === WebPushResult.NotSubscribed) {
            await deleteDevice(kv, deviceId);
            return WebPushResult.NotSubscribed;
        }
        return result;
    });

    return Promise.allSettled(promises) as unknown as Promise<unknown>;
}
