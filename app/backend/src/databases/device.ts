import type { IDevice } from '../types/database/device';

export async function databaseCreateDevice(kv: KVNamespace, device: Readonly<IDevice>): Promise<void> {
    await kv.put(`device:${device.id}`, JSON.stringify(device));
}

export async function databaseUpdateDevice(kv: KVNamespace, device: Readonly<IDevice>): Promise<void> {
    await databaseCreateDevice(kv, device);
}

export async function databaseDeleteDevice(kv: KVNamespace, deviceId: string): Promise<void> {
    await kv.delete(`device:${deviceId}`);
}

export async function databaseGetDevice(kv: KVNamespace, deviceId: string): Promise<IDevice> {
    const value = await kv.get(`device:${deviceId}`);
    if (!value) {
        throw new Error(`Device with id ${deviceId} not found`);
    }
    return JSON.parse(value) as IDevice;
}

export async function databaseGetAllDeviceIDs(kv: KVNamespace): Promise<string[]> {
    const allDeviceIds: string[] = [];
    let cursor: string | undefined;
    let done = false;
    while (!done) {
        const result = await kv.list({ prefix: "device:", cursor });
        for (const key of result.keys) {
            const id = key.name.slice("device:".length);
            allDeviceIds.push(id);
        }
        if (result.list_complete) {
            done = true;
        } else {
            cursor = result.cursor;
        }
    }
    return allDeviceIds;
}
