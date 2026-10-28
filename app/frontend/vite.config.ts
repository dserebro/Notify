import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// The PWA manifest is served from `public/manifest.json` so that the
// existing icons/screenshots keep their URLs. The plugin runs in
// `injectManifest` mode: Workbox precaches build assets into our custom
// `src/sw.ts`, which keeps the push/notification/badge/IndexedDB logic.
export default defineConfig({
    plugins: [
        preact(),
        VitePWA({
            strategies: "injectManifest",
            srcDir: "src",
            filename: "sw.ts",
            injectRegister: null,
            registerType: "prompt",
            manifest: false,
            injectManifest: {
                globPatterns: ["**/*.{js,css,html,png,ico,json,woff2}"],
            },
            devOptions: {
                enabled: false,
                type: "module",
            },
        }),
    ],
    resolve: {
        // Pick up the `source` export condition in `@notify/shared/package.json`
        // so Vite resolves to the TypeScript sources during dev and build,
        // avoiding a pre-build step for the shared package.
        conditions: ["source"],
    },
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:8787",
                changeOrigin: false,
            },
        },
    },
    build: {
        target: "es2022",
    },
});
