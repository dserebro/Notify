import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./types/env";
import { deviceRouter } from "./routes/device";
import { keysRouter } from "./routes/keys";
import { notificationRouter } from "./routes/notify";

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use("/api/*", cors());

app.route("/api/device", deviceRouter);
app.route("/api/keys", keysRouter);
app.route("/api/notify", notificationRouter);

export default app;
