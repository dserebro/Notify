import type { WebPushData } from "@notify/shared";

export type { WebPushData };

export type ExtendedSubscription = PushSubscription & {
    expirationTime?: number;
};

export type ExtractedWebPushData = {
    endpoint: string;
    key: ArrayBuffer;
    auth: ArrayBuffer;
    expirationTime?: number;
};
