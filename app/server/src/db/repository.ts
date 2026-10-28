import type { Device, WebPushData } from "@notify/shared";

/**
 * Storage seam for `devices`. The SQLite implementation lives in
 * `./sqlite.ts`; tests may swap in an in-memory fake with the same
 * shape.
 *
 * All methods are synchronous because better-sqlite3 is synchronous
 * (see MILESTONE.md §5). Keeping the method set tight — no generic
 * query API — makes it easy to review and to re-implement later over
 * `node:sqlite` if needed.
 */
export interface DeviceRepository {
    /** Insert a new device. Throws if a row with the same `id` exists. */
    create(device: Device): void;
    /** Return the device, or null if there is no row with that id. */
    get(id: string): Device | null;
    /** Fast existence check used by auth and PUT /device. */
    exists(id: string): boolean;
    /**
     * Patch `pushData` and/or `secret`, bumping `updated_at`. Returns
     * the updated row, or null if there was no row to update.
     */
    update(
        id: string,
        patch: { pushData?: WebPushData; secret?: string },
    ): Device | null;
    /** Delete the row. Returns true if a row was removed. */
    delete(id: string): boolean;
    /**
     * Return every valid device. Used by `notifyAll` and `listDevices`.
     * Rows that fail `DeviceSchema` are skipped and logged, not thrown.
     */
    listAll(): Device[];
    /** Release the underlying database handle. */
    close(): void;
}
