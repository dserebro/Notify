import { Hono } from "hono";
import type { AppDeps } from "../app.js";

/**
 * `GET /api/health` — small liveness probe added by this milestone
 * (there was no equivalent in the legacy backend). Used by the Docker
 * HEALTHCHECK and by smoke tests.
 */
export function createHealthRoutes(_deps: AppDeps) {
    const app = new Hono();

    app.get("/", (c) => {
        return c.json({ status: "ok" }, 200);
    });

    return app;
}
