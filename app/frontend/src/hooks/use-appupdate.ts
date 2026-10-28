import { useRegisterSW } from "virtual:pwa-register/preact";

/**
 * Returns `true` when the service worker has pulled a new build and is
 * waiting to activate. The returned `update` function tells the SW to
 * `skipWaiting` and reloads the page so the user sees the new assets.
 *
 * The old hook watched `registration.onupdatefound`; `vite-plugin-pwa`
 * wires that same event (through Workbox) and surfaces it as the
 * `needRefresh` tuple, which the update banner has always consumed.
 */
export type AppUpdateInfo = {
    needRefresh: boolean;
    update: () => void;
};

export const useAppUpdate = (): AppUpdateInfo => {
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisterError(error) {
            console.warn("SW registration failed", error);
        },
    });

    return {
        needRefresh,
        update: () => {
            void updateServiceWorker(true);
        },
    };
};
