import { dirname } from "node:path";
import type { Logger } from "../logger.js";
import {
    type Config,
    type ConfigInput,
    ConfigInputSchema,
    ConfigSchema,
    type LogLevel,
} from "./schema.js";
import { resolveVapidKey } from "./vapid.js";

/**
 * Config loader. Merges three sources in order of precedence —
 * flags, environment variables, defaults — validates with the zod
 * schema, resolves the VAPID key (reading or writing `vapid.json` as
 * needed), and returns the typed `Config`.
 *
 * The env mapping mirrors the legacy `deploy.ts` plus the three new
 * variables documented in MILESTONE.md §6 (`DATABASE_PATH`,
 * `LOG_LEVEL`, `TRUST_PROXY`).
 */

const LOG_LEVELS: readonly LogLevel[] = [
    "trace",
    "debug",
    "info",
    "warn",
    "error",
];

/**
 * Parse an env string as a boolean. Only `"true"` and `"1"` count as
 * true, matching the legacy `CORS === "true"` check and avoiding
 * surprises with values like `"false"` that are truthy under JS.
 */
function parseBool(value: string | undefined): boolean | undefined {
    if (value === undefined) {
        return undefined;
    }
    return value === "true" || value === "1";
}

/**
 * Parse an env string as a positive integer. Returns undefined when
 * unset so the loader falls back to the next source.
 */
function parseIntEnv(value: string | undefined): number | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) {
        throw new Error(`expected an integer, got ${JSON.stringify(value)}`);
    }
    return n;
}

/**
 * Narrow a free-form env string into a known log level. Throws for
 * typos so a mis-set `LOG_LEVEL` doesn't silently fall back to info.
 */
function parseLogLevel(value: string | undefined): LogLevel | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }
    const match = LOG_LEVELS.find((lvl) => lvl === value);
    if (!match) {
        throw new Error(
            `invalid LOG_LEVEL ${JSON.stringify(value)}: expected ` +
                LOG_LEVELS.join(", "),
        );
    }
    return match;
}

/**
 * Translate `process.env` into a `ConfigInput`. Only keys that are
 * actually set contribute; everything else stays undefined so the
 * flag layer or the schema default wins.
 */
function envToInput(env: NodeJS.ProcessEnv): ConfigInput {
    const input: ConfigInput = {};
    const port = parseIntEnv(env.PORT);
    if (port !== undefined) {
        input.port = port;
    }
    if (env.HOST !== undefined && env.HOST !== "") {
        input.host = env.HOST;
    }
    if (env.VAPID_KEY !== undefined && env.VAPID_KEY !== "") {
        input.vapidKey = env.VAPID_KEY;
    }
    if (env.SUB !== undefined && env.SUB !== "") {
        input.sub = env.SUB;
    }
    const cors = parseBool(env.CORS);
    if (cors !== undefined) {
        input.cors = cors;
    }
    if (env.FRONTEND !== undefined && env.FRONTEND !== "") {
        input.frontend = env.FRONTEND;
    }
    if (env.SENDKEY !== undefined && env.SENDKEY !== "") {
        input.sendkey = env.SENDKEY;
    }
    if (env.LOGINKEY !== undefined && env.LOGINKEY !== "") {
        input.loginkey = env.LOGINKEY;
    }
    if (env.DATABASE_PATH !== undefined && env.DATABASE_PATH !== "") {
        input.databasePath = env.DATABASE_PATH;
    }
    const level = parseLogLevel(env.LOG_LEVEL);
    if (level !== undefined) {
        input.logLevel = level;
    }
    const trust = parseBool(env.TRUST_PROXY);
    if (trust !== undefined) {
        input.trustProxy = trust;
    }
    return input;
}

/**
 * Merge a lower-precedence source into an accumulator, overwriting
 * only when the incoming value is not `undefined`. `null` is
 * preserved (it carries meaning for the optional-string fields).
 */
function mergeInto(base: ConfigInput, next: ConfigInput): ConfigInput {
    const merged: ConfigInput = { ...base };
    for (const [key, value] of Object.entries(next) as [
        keyof ConfigInput,
        ConfigInput[keyof ConfigInput],
    ][]) {
        if (value !== undefined) {
            // biome-ignore lint/suspicious/noExplicitAny: dynamic assign
            (merged as any)[key] = value;
        }
    }
    return merged;
}

export type LoadConfigOpts = {
    flags?: ConfigInput;
    env?: NodeJS.ProcessEnv;
    logger: Logger;
};

/**
 * Build a fully-resolved `Config`. Precedence: `flags` > `env` > the
 * schema's own defaults. After merging, `resolveVapidKey` either
 * returns the configured key or reads/writes `<dataDir>/vapid.json`
 * so the server always has one.
 */
export async function loadConfig(opts: LoadConfigOpts): Promise<Config> {
    const { flags, env = process.env, logger } = opts;

    const envInput = ConfigInputSchema.parse(envToInput(env));
    const flagInput = flags ? ConfigInputSchema.parse(flags) : {};

    // Lower precedence first; higher precedence overwrites.
    const merged = mergeInto(envInput, flagInput);

    // Fill the VAPID key before the strict schema runs — the schema
    // treats it as required.
    const databasePath = merged.databasePath ?? "./data/notify.db";
    const dataDir = dirname(databasePath);
    const vapidKey = await resolveVapidKey({
        configuredKey: merged.vapidKey ?? null,
        dataDir,
        logger,
    });

    // `sub` has no safe default — if neither flag nor env set it, we
    // reuse the legacy fallback so dev flows keep working. The server
    // owner is expected to override in production.
    const sub = merged.sub ?? "mailto:example@example.com";

    const resolved = {
        ...merged,
        vapidKey,
        sub,
    };

    return ConfigSchema.parse(resolved);
}

/**
 * Produce a logger-safe snapshot of a config. The three secret-ish
 * fields (`vapidKey`, `sendkey`, `loginkey`) are replaced by a marker
 * that reveals only whether they are set and how long they are, so
 * ops can confirm a config was wired without leaking tokens.
 */
export function redactConfig(config: Config): Record<string, unknown> {
    const mask = (value: string | null): string | null => {
        if (value === null) {
            return null;
        }
        return `*** (set, len=${value.length})`;
    };
    return {
        port: config.port,
        host: config.host,
        vapidKey: `*** (set, len=${config.vapidKey.length})`,
        sub: config.sub,
        cors: config.cors,
        frontend: config.frontend,
        sendkey: mask(config.sendkey),
        loginkey: mask(config.loginkey),
        databasePath: config.databasePath,
        logLevel: config.logLevel,
        trustProxy: config.trustProxy,
    };
}
