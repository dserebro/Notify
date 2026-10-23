import { databaseCreateDevice } from "../../databases/device";
import type { IDevice } from "../../types/database/device";
import { generateRandomId } from "../../webpush/util";
import type { WebPushInfos } from "../../webpush/webpushinfos";

export async function createDevice(kv: KVNamespace, webPushData: WebPushInfos): Promise<IDevice> {
    const device: IDevice = {
        id: generateRandomId(),
        secret: generateRandomId(),
        pushData: webPushData,
    };
    await databaseCreateDevice(kv, device);
    return device;
}
