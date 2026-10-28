import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "./logger.js";

/**
 * SPA static-file handler used when `FRONTEND` points at a built
 * frontend directory. Hand-rolled rather than reusing
 * `@hono/node-server/serve-static` because the SPA fallback plus the
 * `sw.js` no-cache and hashed-asset immutable rules are easier to
 * express directly.
 *
 * Behaviour:
 *   - Any method other than GET/HEAD is passed through.
 *   - `/api/*` paths are passed through so the API router owns them.
 *   - A matching file is served with an ETag, a `Content-Type` from the
 *     extension map, and a `Cache-Control` that is `no-cache` for
 *     `sw.js` or `public, max-age=31536000, immutable` for anything
 *     under `/assets/`.
 *   - If no file matches and the request accepts `text/html`,
 *     `index.html` is served with `Cache-Control: no-cache` (SPA
 *     fallback).
 *   - Otherwise the request falls through to `next()`.
 */

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
    ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
    const ext = extname(path).toLowerCase();
    return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export type StaticHandlerOpts = {
    root: string;
    logger: Logger;
};

export function createStaticHandler(
    opts: StaticHandlerOpts,
): MiddlewareHandler {
    const absoluteRoot = resolve(opts.root);

    return async (c, next) => {
        if (c.req.method !== "GET" && c.req.method !== "HEAD") {
            await next();
            return;
        }

        let urlPath: string;
        try {
            urlPath = decodeURIComponent(new URL(c.req.url).pathname);
        } catch {
            await next();
            return;
        }

        if (urlPath.startsWith("/api/")) {
            await next();
            return;
        }

        const requested = urlPath === "/" ? "/index.html" : urlPath;
        const safePath = resolve(absoluteRoot, `.${requested}`);
        const insideRoot =
            safePath === absoluteRoot ||
            safePath.startsWith(`${absoluteRoot}/`);
        if (!insideRoot) {
            await next();
            return;
        }

        try {
            const info = await stat(safePath);
            if (info.isFile()) {
                return serveFile(c, safePath, urlPath);
            }
        } catch {
            // fall through to SPA fallback
        }

        const accept = c.req.header("accept") ?? "";
        if (!accept.includes("text/html")) {
            await next();
            return;
        }

        try {
            const indexPath = resolve(absoluteRoot, "index.html");
            const bytes = await readFile(indexPath);
            const etag = etagFor(bytes);
            if (c.req.header("if-none-match") === etag) {
                return c.body(null, 304, {
                    ETag: etag,
                    "Cache-Control": "no-cache",
                });
            }
            return c.body(bytes, 200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-cache",
                ETag: etag,
            });
        } catch (err) {
            opts.logger.warn("static index.html missing", {
                root: absoluteRoot,
                error: err instanceof Error ? err.message : String(err),
            });
            await next();
            return;
        }
    };
}

function etagFor(bytes: Buffer): string {
    return `"${createHash("sha1").update(bytes).digest("hex")}"`;
}

async function serveFile(
    c: Parameters<MiddlewareHandler>[0],
    absolutePath: string,
    urlPath: string,
): Promise<Response> {
    const bytes = await readFile(absolutePath);
    const etag = etagFor(bytes);
    const isServiceWorker = urlPath === "/sw.js";
    const isHashedAsset = urlPath.startsWith("/assets/");
    const cacheControl = isServiceWorker
        ? "no-cache"
        : isHashedAsset
          ? "public, max-age=31536000, immutable"
          : "no-cache";

    if (c.req.header("if-none-match") === etag) {
        return c.body(null, 304, {
            ETag: etag,
            "Cache-Control": cacheControl,
        });
    }

    return c.body(bytes, 200, {
        "Content-Type": contentType(absolutePath),
        "Cache-Control": cacheControl,
        ETag: etag,
    });
}
