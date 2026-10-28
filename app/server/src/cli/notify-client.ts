/**
 * `notify notify` CLI client. Ported from `app/backend/client/mod.ts`
 * so operators can POST a notification to a running server from the
 * same binary.
 *
 * The remote URL is the server's base (default `http://localhost:8787`),
 * optionally with a sub-path for reverse-proxied instances; `api/notify`
 * is joined onto that path (see `resolveNotifyUrl`). A remote that
 * already ends in `/api/notify` is used verbatim, as the legacy client did.
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
 * Build the notify endpoint URL from `--remote`, keeping any path:
 *   http://host:8787              → http://host:8787/api/notify
 *   https://example.com/notify    → https://example.com/notify/api/notify
 *   https://example.com/api/notify → unchanged
 */
export function resolveNotifyUrl(remote: string): string {
    const base = new URL(remote);
    if (base.pathname.replace(/\/+$/, "").endsWith("/api/notify")) {
        return base.toString();
    }
    if (!base.pathname.endsWith("/")) {
        base.pathname = `${base.pathname}/`;
    }
    return new URL("api/notify", base).toString();
}

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

    const url = resolveNotifyUrl(remote);
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
