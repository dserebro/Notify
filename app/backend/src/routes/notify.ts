import { Hono } from "hono";
import type { Env } from "../types/env";
import { MessageValidator } from "../types/message";
import { failure, success } from "../types/apiresponse";
import { notifyAll } from "../logic/project/notify";
import { validatePushSecret } from "../middleware/auth";

const notify = new Hono<{ Bindings: Env }>();

notify.post("/", validatePushSecret, async (c) => {
    const rawMessage = await c.req.json();
    const parsed = MessageValidator.safeParse(rawMessage);
    if (!parsed.success) {
        return failure({ type: "invalid_data", message: "invalid message" }, { status: 400 });
    }
    const stringData = JSON.stringify(parsed.data);
    if (stringData.length > 2048) {
        return failure({ type: "invalid_data", message: "data too long" }, { status: 400 });
    }

    try {
        await notifyAll(c.env.DEVICES, atob(c.env.VAPID_KEY), c.env.SUB, stringData);
        return success({ message: "notified" });
    } catch (error) {
        return failure({ type: "internal_error", message: (error as Error).message });
    }
});

export { notify as notificationRouter };
