import { Hono } from "hono";
import type { Env } from "../types/env";
import { failure, success } from "../types/apiresponse";
import { WebPushInfosSchema } from "../webpush/webpushinfos";
import { createDevice } from "../logic/device/create";
import { checkDevice } from "../logic/device/check";
import { updateDevice } from "../logic/device/update";
import { deleteDevice } from "../logic/device/delete";
import { validateDeviceSecret, validateUserLoginKey } from "../middleware/auth";

const device = new Hono<{ Bindings: Env }>();

device.post("/", validateUserLoginKey, async (c) => {
    const formData = await c.req.json();
    const { web_push_data: subscriptionData } = formData;

    const parsed = WebPushInfosSchema.safeParse(subscriptionData);
    if (!parsed.success) {
        return failure({ type: "invalid_data", message: "invalid web_push_data" }, { status: 400 });
    }

    try {
        const result = await createDevice(c.env.DEVICES, parsed.data);
        return success({ id: result.id, secret: result.secret });
    } catch (error) {
        return failure({ type: "internal_error", message: (error as Error).message });
    }
});

device.get("/:device_id", validateDeviceSecret, async (c) => {
    const deviceId = c.req.param("device_id");
    if (await checkDevice(c.env.DEVICES, deviceId)) {
        return success({ exists: true });
    }
    return failure({ type: "not_found", message: "device not found" }, { status: 404 });
});

device.patch("/:device_id", validateDeviceSecret, async (c) => {
    const deviceId = c.req.param("device_id");
    const body = await c.req.json();
    const { web_push_data: subscriptionData } = body;

    const parsed = WebPushInfosSchema.safeParse(subscriptionData);
    if (!parsed.success) {
        return failure({ type: "invalid_data", message: "invalid web_push_data" }, { status: 400 });
    }

    const secret = c.req.header("authorization");

    try {
        await updateDevice(c.env.DEVICES, deviceId, String(secret), parsed.data);
        return success(true);
    } catch (error) {
        return failure({ type: "internal_error", message: (error as Error).message });
    }
});

device.delete("/:device_id", validateDeviceSecret, async (c) => {
    const deviceId = c.req.param("device_id");
    try {
        await deleteDevice(c.env.DEVICES, deviceId);
        return success(true);
    } catch (error) {
        return failure({ type: "internal_error", message: (error as Error).message });
    }
});

export { device as deviceRouter };
