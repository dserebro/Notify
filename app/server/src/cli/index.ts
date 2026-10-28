import { Command } from "commander";
import { createLogger, type Logger } from "../logger.js";
import { generateCommand } from "./generate.js";
import { importDevicesCommand } from "./import-devices.js";
import { notifyCommand } from "./notify-client.js";
import { runCommand } from "./run.js";

/**
 * Build the `notify` CLI. One commander program replaces the legacy
 * Denomander command in `app/backend/main.ts` and the env-only
 * `deploy.ts` entrypoint. See MILESTONE.md §6.
 *
 * Subcommands:
 *   - `run` (default): load config and start the HTTP server.
 *   - `generate`: print a fresh base64(JWK) VAPID key.
 *   - `notify`: POST a notification to a running server.
 *   - `import-devices <file>`: upsert devices from a JSON array.
 *
 * Flag names and env var mappings are preserved from the legacy
 * backend so existing operator muscle memory keeps working.
 */

export type CreateProgramDeps = {
    logger?: Logger;
};

/**
 * Narrow the untyped commander option bag into a `ConfigInput`
 * patch that mirrors the strict schema. Each flag is only
 * forwarded when it was actually set so defaults still apply.
 */
function runOptionsToFlags(
    opts: Record<string, unknown>,
): Record<string, unknown> {
    const flags: Record<string, unknown> = {};
    if (opts.port !== undefined) {
        flags.port = Number(opts.port);
    }
    if (opts.host !== undefined) {
        flags.host = String(opts.host);
    }
    if (opts.vapidkey !== undefined) {
        flags.vapidKey = String(opts.vapidkey);
    }
    if (opts.sub !== undefined) {
        flags.sub = String(opts.sub);
    }
    if (opts.cors !== undefined) {
        flags.cors = Boolean(opts.cors);
    }
    if (opts.frontend !== undefined) {
        flags.frontend = String(opts.frontend);
    }
    if (opts.sendkey !== undefined) {
        flags.sendkey = String(opts.sendkey);
    }
    if (opts.loginkey !== undefined) {
        flags.loginkey = String(opts.loginkey);
    }
    if (opts.database !== undefined) {
        flags.databasePath = String(opts.database);
    }
    if (opts.logLevel !== undefined) {
        flags.logLevel = String(opts.logLevel);
    }
    if (opts.trustProxy !== undefined) {
        flags.trustProxy = Boolean(opts.trustProxy);
    }
    return flags;
}

export function createProgram(deps: CreateProgramDeps = {}): Command {
    const logger = deps.logger ?? createLogger("info");

    const program = new Command();
    program
        .name("notify")
        .description(
            "Notify server CLI (run the server, generate a VAPID key, " +
                "send a notification, or import devices).",
        )
        .version("1.0.0");

    const run = new Command("run")
        .description("Run the HTTP server (default command)")
        .option("-p, --port <number>", "listen port")
        .option("--host <host>", "listen host")
        .option("--vapidkey <base64>", "base64(JWK) VAPID private key")
        .option("--sub <mailto>", "VAPID subscription contact (mailto:)")
        .option("-c, --cors", "enable CORS")
        .option("-f, --frontend <path>", "path to the frontend build")
        .option("--sendkey <key>", "api key required to POST /api/notify")
        .option("--loginkey <key>", "api key required to log into the UI")
        .option("--database <path>", "SQLite database path")
        .option(
            "--log-level <level>",
            "log level (trace|debug|info|warn|error)",
        )
        .option("--trust-proxy", "trust X-Forwarded-* headers")
        .action(async (opts: Record<string, unknown>) => {
            await runCommand(runOptionsToFlags(opts), { logger });
        });
    program.addCommand(run, { isDefault: true });

    program
        .command("generate")
        .description("Generate a new base64(JWK) VAPID private key")
        .action(async () => {
            await generateCommand();
        });

    program
        .command("notify")
        .description("Send a test notification to a running server")
        .requiredOption("-t, --title <title>", "notification title")
        .requiredOption("-m, --message <message>", "notification body")
        .option("-i, --icon <url>", "notification icon URL")
        .option("--tags <csv>", "comma-separated list of tags")
        .option(
            "-r, --remote <url>",
            "server base URL",
            "http://localhost:8787",
        )
        .option("-k, --key <sendkey>", "SENDKEY bearer token")
        .action(
            async (opts: {
                title: string;
                message: string;
                icon?: string;
                tags?: string;
                remote: string;
                key?: string;
            }) => {
                await notifyCommand(opts);
            },
        );

    program
        .command("import-devices <file>")
        .description(
            "Import devices from a JSON array (output of " +
                "scripts/export-deno-kv.ts).",
        )
        .option("--database <path>", "SQLite database path override")
        .action(async (file: string, opts: { database?: string }) => {
            await importDevicesCommand(file, opts, { logger });
        });

    return program;
}
