import { z } from "zod";
import { WebPushDataSchema } from "./web-push-data.js";

/**
 * A registered device: the opaque 32-char `id` and `secret` the
 * client sends on each authenticated request, the Web Push
 * subscription data the server encrypts to, and the create/update
 * timestamps.
 *
 * `createdAt`/`updatedAt` are epoch milliseconds (per
 * MILESTONE.md §3, decision 3) set by the SQLite repository. The
 * legacy Deno KV layer did not persist timestamps; they are added
 * here so the SQLite migration can order rows and so the upsert
 * path of `import-devices` can preserve `created_at`.
 */
export const DeviceSchema = z.object({
    id: z.string().length(32),
    secret: z.string().length(32),
    pushData: WebPushDataSchema,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
});

export type Device = z.infer<typeof DeviceSchema>;
