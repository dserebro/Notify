import { z } from "zod";

/**
 * Maximum serialized size, in bytes, of a notification message body.
 * The legacy backend enforced this against `JSON.stringify(message)`
 * via `routes/notify.ts`. Web Push payloads above ~4 KiB are
 * uncomfortably large; the 2048-byte ceiling comes from the original
 * contract and is preserved here (see MILESTONE.md §3).
 */
export const MESSAGE_MAX_BYTES = 2048;

/**
 * Zod schema for the body of `POST /api/notify`.
 *
 * `title` and `message` carry the user-visible notification text.
 * `icon` (optional) must be a URL (any scheme the WHATWG `URL` parser
 * accepts). `tags` is an optional array of short strings grouped with
 * the notification in the PWA's inbox.
 *
 * Caps mirror the legacy `MessageValidator`.
 */
export const MessageSchema = z.object({
    title: z.string().min(1).max(1024),
    message: z.string().min(1).max(1024),
    icon: z.string().url().max(1024).optional(),
    tags: z.array(z.string().min(1).max(256)).optional(),
});

export type Message = z.infer<typeof MessageSchema>;

/**
 * True iff the serialized payload fits within the 2048 ceiling. The
 * legacy backend compared `JSON.stringify(message).length` directly, so
 * the check counts UTF-16 code units — not UTF-8 bytes — to keep
 * already-sent payloads at the edge accepting/rejecting identically.
 */
export function enforceMessageSize(serialized: string): boolean {
    return serialized.length <= MESSAGE_MAX_BYTES;
}
