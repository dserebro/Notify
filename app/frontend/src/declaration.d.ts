/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "*.module.css" {
    const mapping: Record<string, string>;
    export default mapping;
}
