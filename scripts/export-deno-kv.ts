#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env --unstable-kv
/**
 * One-off exporter: read every `["device", id]` entry from a Deno KV store and
 * write them as a JSON array compatible with `notify import-devices`.
 *
 * Usage:
 *     # against a Deno Deploy KV database (needs DENO_KV_ACCESS_TOKEN):
 *     DENO_KV_ACCESS_TOKEN=... deno run --unstable-kv --allow-net --allow-env --allow-write \
 *         scripts/export-deno-kv.ts \
 *         --kv https://api.deno.com/databases/<uuid>/connect \
 *         --out devices.json
 *
 *     # against a local Deno KV file:
 *     deno run --unstable-kv --allow-read --allow-write \
 *         scripts/export-deno-kv.ts --kv ./app/data/local.db --out devices.json
 *
 * After exporting, run `notify import-devices devices.json` against the new
 * SQLite-backed Node server (with the SAME `VAPID_KEY`) so existing devices
 * keep receiving pushes.
 */

interface PushData {
    endpoint: string;
    key: string;
    auth: string;
}

interface LegacyDevice {
    id: string;
    secret: string;
    pushData: PushData;
}

interface ExportedDevice extends LegacyDevice {
    /** Epoch milliseconds, filled by the importer if missing. */
    createdAt?: number;
    updatedAt?: number;
}

function parseArgs(args: string[]): { kv: string | undefined; out: string } {
    let kv: string | undefined;
    let out = "devices.json";
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--kv" && i + 1 < args.length) {
            kv = args[++i];
        } else if (arg === "--out" && i + 1 < args.length) {
            out = args[++i];
        } else if (arg === "-h" || arg === "--help") {
            console.log(
                "Usage: deno run --unstable-kv --allow-net --allow-read --allow-write --allow-env scripts/export-deno-kv.ts " +
                    "[--kv <path or url>] [--out <file>]",
            );
            Deno.exit(0);
        }
    }
    return { kv, out };
}

async function main(): Promise<void> {
    const { kv: kvArg, out } = parseArgs(Deno.args);

    // deno-lint-ignore no-explicit-any
    const openKv = (Deno as any).openKv as (path?: string) => Promise<{
        list: (opts: {
            prefix: unknown[];
        }) => AsyncIterable<{ key: unknown[]; value: unknown }>;
        close: () => void;
    }>;

    if (typeof openKv !== "function") {
        console.error(
            "Deno.openKv is not available. Run with --unstable-kv (Deno 1.38+ / 2.x; --unstable on older 1.x).",
        );
        Deno.exit(1);
    }

    const kv = await openKv(kvArg);
    const devices: ExportedDevice[] = [];

    try {
        for await (const entry of kv.list({ prefix: ["device"] })) {
            const raw = entry.value;
            try {
                const parsed =
                    typeof raw === "string"
                        ? (JSON.parse(raw) as LegacyDevice)
                        : (raw as LegacyDevice);
                if (!parsed?.id || !parsed?.secret || !parsed?.pushData) {
                    console.warn(
                        `Skipping malformed device ${String(entry.key[1])}`,
                    );
                    continue;
                }
                devices.push(parsed);
            } catch (err) {
                console.warn(
                    `Skipping unparseable device ${String(entry.key[1])}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                );
            }
        }
    } finally {
        kv.close();
    }

    await Deno.writeTextFile(out, `${JSON.stringify(devices, null, 2)}\n`);
    console.log(`Wrote ${devices.length} device(s) to ${out}`);
}

if (import.meta.main) {
    await main();
}
