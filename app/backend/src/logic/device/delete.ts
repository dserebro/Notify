import { databaseDeleteDevice } from "../../databases/device";

export async function deleteDevice(kv: KVNamespace, deviceId: string): Promise<void> {
    await databaseDeleteDevice(kv, deviceId);
}
