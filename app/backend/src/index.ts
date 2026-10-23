import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types/env";
import { EnvValidator } from "./types/env";
import { failure } from "./types/apiresponse";
import { deviceRouter } from "./routes/device";
import { keysRouter } from "./routes/keys";
import { notificationRouter } from "./routes/notify";

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());

app.use("/api/*", async (c, next) => {
    if (c.env.CORS === "true") {
        const corsMiddleware = cors();
        return corsMiddleware(c, next);
    }
    return next();
});

app.use("/api/*", async (c, next) => {
    const result = EnvValidator.safeParse(c.env);
    if (!result.success) {
        return failure({ type: "internal_error", message: "Invalid environment configuration" }, { status: 500 });
    }
    return next();
});

app.route("/api/device", deviceRouter);
app.route("/api/keys", keysRouter);
app.route("/api/notify", notificationRouter);

export default app;
