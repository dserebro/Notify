import { databaseUpdateDevice } from "../../databases/device";
import type { WebPushInfos } from "../../webpush/webpushinfos";

export async function updateDevice(kv: KVNamespace, id: string, secret: string, pushData: WebPushInfos): Promise<void> {
    await databaseUpdateDevice(kv, { id, secret, pushData });
}
