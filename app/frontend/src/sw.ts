/// <reference lib="webworker" />
import { fromBinary } from "@notify/shared";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { getDatabase, getUnreadMessageCount } from "./database/message";
import { updateDevice } from "./services/apiservice";
import type { MessageType } from "./types/messagetype";
import type { ExtendedSubscription, WebPushData } from "./types/webpushdata";
import { encodeWebPushData, getWebPushData } from "./util/webpushutil";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback: route every top-level navigation to the
// precached `index.html`, matching the legacy service worker. API
// calls never match because they do not accept HTML and are handled by
// the backend directly.
registerRoute(
    new NavigationRoute(
        async () => {
            const cache = await caches.open(
                `workbox-precache-v2-${self.registration.scope}`,
            );
            const cached = await cache.match("/index.html");
            return cached ?? fetch("/index.html");
        },
        {
            denylist: [/^\/api\//],
        },
    ),
);

async function addMessageToDB(messageData: MessageType): Promise<void> {
    try {
        const db = await getDatabase();
        await db.add("messages", messageData);
    } catch (e) {
        console.error("addMessageToDB", e);
    }
}

async function sendMessageToMainWindow(messageData: {
    type: "notification";
    data: MessageType;
}): Promise<void> {
    if (typeof BroadcastChannel !== "undefined") {
        const bc = new BroadcastChannel("notify-channel");
        bc.postMessage(messageData);
        bc.close();
        return;
    }
    const clientList = await self.clients.matchAll({ type: "window" });
    for (const client of clientList) {
        client.postMessage(messageData);
    }
}

async function setAppBadge(): Promise<void> {
    const unreadCount = await getUnreadMessageCount().catch(() => 0);
    const nav = navigator as Navigator & {
        setAppBadge?: (count: number) => void;
        clearAppBadge?: () => void;
    };
    if (nav.setAppBadge && nav.clearAppBadge) {
        if (unreadCount > 0) {
            nav.setAppBadge(unreadCount);
        } else {
            nav.clearAppBadge();
        }
    }
}

self.addEventListener("activate", (event) => {
    event.waitUntil(getDatabase().catch((error) => console.warn(error)));
});

// A new build waits until the user accepts the update banner;
// `updateServiceWorker(true)` from virtual:pwa-register posts SKIP_WAITING.
self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") {
        void self.skipWaiting();
    }
});

self.addEventListener("push", (event) => {
    if (!event.data) {
        throw new Error("No data in push event");
    }

    const rawData = event.data.text();
    const jsonData = fromBinary(atob(rawData));
    const parsed = JSON.parse(jsonData) as {
        title: string;
        message: string;
        icon?: string;
        tags?: string[];
    };
    const { title, message: body, icon = "", tags = [] } = parsed;

    // Random tag so simultaneous pushes do not collapse into one visible
    // notification. Matches the historical sw.js behavior.
    const tag = (Math.random() + 1).toString(36).substring(7);

    const messageData: MessageType = {
        body,
        icon,
        title,
        tags,
        receivedAt: Number(Date.now()),
        read: false,
    };

    event.waitUntil(
        Promise.allSettled([
            self.registration.showNotification(title, {
                body,
                tag,
                icon: icon || undefined,
            }),
            addMessageToDB(messageData),
            sendMessageToMainWindow({
                type: "notification",
                data: messageData,
            }),
            setAppBadge(),
        ]),
    );
});

self.addEventListener("notificationclick", (event) => {
    const notification = event.notification;
    const load = async (): Promise<void> => {
        const nav = navigator as Navigator & {
            clearAppBadge?: () => void;
        };
        nav.clearAppBadge?.();
        try {
            const clientList = await self.clients.matchAll({
                type: "window",
            });
            const windowClient = clientList[0];
            if (windowClient) {
                const navigated = await windowClient.navigate("/");
                navigated?.focus();
            } else {
                await self.clients.openWindow("/");
            }
        } finally {
            notification.close();
        }
    };
    event.waitUntil(load());
});

self.addEventListener("pushsubscriptionchange", (event) => {
    const typedEvent = event as PushSubscriptionChangeEvent;
    const { oldSubscription, newSubscription } = typedEvent;
    console.log("pushsubscriptionchange", oldSubscription, newSubscription);
    const upgradeSubscription = async (): Promise<void> => {
        const database = await getDatabase();
        const users = await database.getAll("user");
        const user = users[0];
        if (user?.id) {
            const { id, secret } = user;
            const newSub =
                newSubscription ??
                (oldSubscription
                    ? await self.registration.pushManager.subscribe(
                          oldSubscription.options,
                      )
                    : null);
            if (!newSub) {
                return;
            }
            const webPushData: WebPushData = encodeWebPushData(
                getWebPushData(newSub as ExtendedSubscription),
            );
            const response = await updateDevice(id, secret, webPushData);
            console.log("pushsubscriptionchange", response);
        }
    };
    event.waitUntil(upgradeSubscription());
});

/**
 * Minimal typing for `pushsubscriptionchange` since lib.dom.d.ts does
 * not yet include it in a cross-browser form.
 */
interface PushSubscriptionChangeEvent extends ExtendableEvent {
    readonly oldSubscription: PushSubscription | null;
    readonly newSubscription: PushSubscription | null;
}
