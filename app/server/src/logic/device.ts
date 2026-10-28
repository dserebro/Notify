import type { Device, WebPushData } from "@notify/shared";
import type { AppDeps } from "../app.js";
import { generateRandomId } from "../webpush/util.js";

/**
 * Thin logic wrappers for device CRUD. The routes call these so the
 * handler bodies stay focused on validation and response shape.
 *
 * `generateRandomId` returns the 32-char hex strings the public API
 * contract advertises (see `DeviceSchema` in `@notify/shared`).
 */

export function createDevice(deps: AppDeps, pushData: WebPushData): Device {
    const now = Date.now();
    const device: Device = {
        id: generateRandomId(),
        secret: generateRandomId(),
        pushData,
        createdAt: now,
        updatedAt: now,
    };
    deps.repository.create(device);
    return device;
}

/**
 * Apply a patch to an existing device. The decision-13 fix is at the
 * call site: `routes/device.ts` only ever passes `pushData`, so the
 * secret stays intact across PATCH requests.
 */
export function patchDevice(
    deps: AppDeps,
    device: Device,
    patch: { pushData?: WebPushData; secret?: string },
): Device {
    const updated = deps.repository.update(device.id, patch);
    // Middleware already proved the device exists; a null here means a
    // race with concurrent delete, in which case the pre-middleware
    // snapshot is still the most recent view the caller has.
    return updated ?? device;
}

export function deleteDevice(deps: AppDeps, device: Device): void {
    deps.repository.delete(device.id);
}
