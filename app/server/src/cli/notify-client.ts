/**
 * `notify notify` CLI client. Ported from `app/backend/client/mod.ts`
 * so operators can POST a notification to a running server from the
 * same binary.
 *
 * The remote URL is the server's base (default `http://localhost:8787`);
 * the path appended here is `/api/notify`, matching the Hono route.
 *
 * The payload is the shared `Message` type, so the client cannot drift
 * from the server schema (the legacy client sent `iconUrl`, which the
 * server silently dropped).
 */

import type { Message } from "@notify/shared";

export type NotifyOptions = {
    title: string;
    message: string;
    icon?: string;
    tags?: string;
    remote: string;
    key?: string;
};

/**
 * POST the message to the server's `/api/notify` endpoint. On a
 * non-2xx response, try to pull the typed `error.message` out of the
 * API envelope and throw it — otherwise fall back to the status text.
 */
export async function postNotification(
    remote: string,
    message: Message,
    serverKey?: string,
): Promise<Response> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (serverKey) {
        headers.Authorization = `Bearer ${serverKey}`;
    }

    const url = new URL("/api/notify", remote).toString();
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
    });

    if (!response.ok) {
        let detail = response.statusText;
        try {
            const body = (await response.json()) as {
                error?: { message?: string };
            };
            if (body?.error?.message) {
                detail = body.error.message;
            }
        } catch {
            // fall through to statusText
        }
        throw new Error(`notify failed (${response.status}): ${detail}`);
    }

    return response;
}

/**
 * Handle `notify notify --title ... --message ...`. Builds the
 * message payload (tags are split on comma, matching the legacy
 * client), posts it, and writes a one-line confirmation.
 */
export async function notifyCommand(opts: NotifyOptions): Promise<void> {
    const message: Message = {
        title: opts.title,
        message: opts.message,
    };
    if (opts.icon) {
        message.icon = opts.icon;
    }
    if (opts.tags) {
        message.tags = opts.tags
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);
    }
    await postNotification(opts.remote, message, opts.key);
    process.stdout.write("Notification sent\n");
}
