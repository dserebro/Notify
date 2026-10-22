import { databaseGetDevice } from "../../databases/device";

export async function checkDevice(kv: KVNamespace, deviceId: string): Promise<boolean> {
    return await databaseGetDevice(kv, deviceId).then(() => true).catch(() => false);
}
