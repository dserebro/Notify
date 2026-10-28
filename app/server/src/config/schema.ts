import { z } from "zod";

/**
 * Config shape for the Notify server. Field names mirror the legacy
 * `AppParametersValidator` (`app/backend/types/appparameters.ts`),
 * with `databasePath`, `logLevel` and `trustProxy` added per
 * MILESTONE.md §6.
 *
 * The schema is split in two:
 *   - `ConfigInputSchema` is what the loader accepts after merging
 *     flags and env vars. Every field is optional, and `vapidKey` may
 *     be unset at this point: the loader fills it with `resolveVapidKey`
 *     before the final validation.
 *   - `ConfigSchema` is the strict shape every runtime consumer sees.
 *     It requires `vapidKey` and `sub`, and applies the defaults
 *     listed in MILESTONE.md §6.
 *
 * The parsed `Config` is passed to `createApp(deps)` and to the
 * repository/VAPID loader. The redacted snapshot used for logging
 * lives in `./load.ts`.
 */

/** Allowed log levels. Mirrors `LogLevel` in `../logger.ts`. */
export const LogLevelSchema = z.enum([
    "trace",
    "debug",
    "info",
    "warn",
    "error",
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Fully-resolved config. The loader builds one of these from flags +
 * env + defaults, resolves the VAPID key, and hands it to the rest of
 * the server. See `./load.ts` for precedence rules.
 */
export const ConfigSchema = z.object({
    port: z.number().int().min(1).max(65535).default(8787),
    host: z.string().min(1).default("0.0.0.0"),
    vapidKey: z.string().min(1),
    sub: z.string().startsWith("mailto:"),
    cors: z.boolean().default(false),
    frontend: z.string().nullable().default(null),
    sendkey: z.string().nullable().default(null),
    loginkey: z.string().nullable().default(null),
    databasePath: z.string().min(1).default("./data/notify.db"),
    logLevel: LogLevelSchema.default("info"),
    trustProxy: z.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Partial input accepted by the loader. All fields are optional and
 * `vapidKey` is nullable so a config file / env without a key can be
 * merged before `resolveVapidKey` fills it in.
 */
export const ConfigInputSchema = z.object({
    port: z.number().int().min(1).max(65535).optional(),
    host: z.string().min(1).optional(),
    vapidKey: z.string().min(1).nullable().optional(),
    sub: z.string().startsWith("mailto:").optional(),
    cors: z.boolean().optional(),
    frontend: z.string().nullable().optional(),
    sendkey: z.string().nullable().optional(),
    loginkey: z.string().nullable().optional(),
    databasePath: z.string().min(1).optional(),
    logLevel: LogLevelSchema.optional(),
    trustProxy: z.boolean().optional(),
});

export type ConfigInput = z.infer<typeof ConfigInputSchema>;
