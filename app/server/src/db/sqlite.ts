import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Device, DeviceSchema, type WebPushData } from "@notify/shared";
import Database from "better-sqlite3";
import type { DeviceRepository } from "./repository.js";

/**
 * Minimal logger surface used by this module. The CLI will wire in a
 * real pino/console logger in a later task; this interface stays
 * tiny so the DB layer does not depend on a specific implementation.
 */
export type Logger = {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
};

const NOOP_LOGGER: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

/**
 * Row shape of the `devices` table. SQLite columns are snake_case to
 * mirror the legacy export, and `push_data` is JSON-encoded text.
 */
type DeviceRow = {
    id: string;
    secret: string;
    push_data: string;
    created_at: number;
    updated_at: number;
};

/**
 * Parse a `devices` row into a `Device`, validating with `DeviceSchema`.
 * Throws a tagged error on bad JSON or schema failure so callers can
 * include the id in logs.
 */
function rowToDevice(row: DeviceRow): Device {
    let pushData: unknown;
    try {
        pushData = JSON.parse(row.push_data);
    } catch {
        throw new Error("corrupt device row: " + row.id);
    }
    const parsed = DeviceSchema.safeParse({
        id: row.id,
        secret: row.secret,
        pushData,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    });
    if (!parsed.success) {
        throw new Error("corrupt device row: " + row.id);
    }
    return parsed.data;
}

/**
 * Sort migration files by their numeric prefix (`001_`, `002_`, ...),
 * so `010_x.sql` lands after `009_x.sql` rather than before `002_x.sql`.
 */
function migrationOrder(name: string): number {
    const match = /^(\d+)/.exec(name);
    if (!match) {
        throw new Error(`migration filename missing numeric prefix: ${name}`);
    }
    return Number.parseInt(match[1], 10);
}

/**
 * Apply any pending migrations in a single transaction, tracking the
 * applied count with `PRAGMA user_version` (see briefing §3).
 */
function applyMigrations(
    db: Database.Database,
    migrationsDir: string,
    logger: Logger,
): void {
    const files = readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort((a, b) => migrationOrder(a) - migrationOrder(b));

    const current = db.pragma("user_version", { simple: true }) as number;
    if (current > files.length) {
        throw new Error(
            `database user_version (${current}) is ahead of ` +
                `available migrations (${files.length})`,
        );
    }
    if (current === files.length) {
        return;
    }

    const pending = files.slice(current);
    logger.info("applying sqlite migrations", {
        from: current,
        to: files.length,
        count: pending.length,
    });

    const run = db.transaction(() => {
        let version = current;
        for (const file of pending) {
            const sql = readFileSync(join(migrationsDir, file), "utf8");
            db.exec(sql);
            version += 1;
            db.pragma(`user_version = ${version}`);
        }
    });
    run();
}

/**
 * Build a SQLite-backed `DeviceRepository` at `databasePath`. The parent
 * directory is created on demand so first-run deployments don't need
 * out-of-band setup, and migrations under `src/db/migrations/` are
 * applied before the handle is returned.
 */
export function createSqliteRepository(
    databasePath: string,
    logger: Logger = NOOP_LOGGER,
): DeviceRepository {
    mkdirSync(dirname(databasePath), { recursive: true });

    const db = new Database(databasePath, { fileMustExist: false });
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");

    const migrationsDir = join(import.meta.dirname, "migrations");
    applyMigrations(db, migrationsDir, logger);

    const insertStmt = db.prepare<DeviceRow>(
        "INSERT INTO devices (id, secret, push_data, created_at, " +
            "updated_at) VALUES (@id, @secret, @push_data, @created_at, " +
            "@updated_at)",
    );
    const getStmt = db.prepare<string, DeviceRow>(
        "SELECT id, secret, push_data, created_at, updated_at " +
            "FROM devices WHERE id = ?",
    );
    const existsStmt = db.prepare<string, { one: 1 }>(
        "SELECT 1 as one FROM devices WHERE id = ?",
    );
    const deleteStmt = db.prepare<string>("DELETE FROM devices WHERE id = ?");
    const listStmt = db.prepare<[], DeviceRow>(
        "SELECT id, secret, push_data, created_at, updated_at " +
            "FROM devices ORDER BY created_at ASC",
    );
    const updateSecretStmt = db.prepare<{
        id: string;
        secret: string;
        updated_at: number;
    }>(
        "UPDATE devices SET secret = @secret, updated_at = @updated_at " +
            "WHERE id = @id",
    );
    const updatePushStmt = db.prepare<{
        id: string;
        push_data: string;
        updated_at: number;
    }>(
        "UPDATE devices SET push_data = @push_data, " +
            "updated_at = @updated_at WHERE id = @id",
    );
    const updateBothStmt = db.prepare<{
        id: string;
        secret: string;
        push_data: string;
        updated_at: number;
    }>(
        "UPDATE devices SET secret = @secret, push_data = @push_data, " +
            "updated_at = @updated_at WHERE id = @id",
    );

    const repository: DeviceRepository = {
        create(device) {
            insertStmt.run({
                id: device.id,
                secret: device.secret,
                push_data: JSON.stringify(device.pushData),
                created_at: device.createdAt,
                updated_at: device.updatedAt,
            });
        },
        get(id) {
            const row = getStmt.get(id);
            if (!row) {
                return null;
            }
            return rowToDevice(row);
        },
        exists(id) {
            return existsStmt.get(id) !== undefined;
        },
        update(id, patch) {
            if (patch.secret === undefined && patch.pushData === undefined) {
                // No fields to patch: return the current row (or null).
                return repository.get(id);
            }
            const updatedAt = Date.now();
            let result: Database.RunResult;
            if (patch.secret !== undefined && patch.pushData !== undefined) {
                result = updateBothStmt.run({
                    id,
                    secret: patch.secret,
                    push_data: JSON.stringify(patch.pushData),
                    updated_at: updatedAt,
                });
            } else if (patch.secret !== undefined) {
                result = updateSecretStmt.run({
                    id,
                    secret: patch.secret,
                    updated_at: updatedAt,
                });
            } else {
                result = updatePushStmt.run({
                    id,
                    push_data: JSON.stringify(patch.pushData as WebPushData),
                    updated_at: updatedAt,
                });
            }
            if (result.changes === 0) {
                return null;
            }
            return repository.get(id);
        },
        delete(id) {
            const result = deleteStmt.run(id);
            return result.changes > 0;
        },
        listAll() {
            return listStmt.all().map(rowToDevice);
        },
        close() {
            db.close();
        },
    };

    return repository;
}
