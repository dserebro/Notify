import { generateVapidKey } from "../config/vapid.js";

/**
 * `notify generate` prints a fresh base64(JWK) VAPID key to stdout.
 * The caller can pipe it into `.env`, Docker secrets or systemd.
 *
 * The key-generation logic lives in `../config/vapid.ts` so the auto-
 * persist path uses the same implementation.
 */
export async function generateCommand(): Promise<void> {
    const key = await generateVapidKey();
    process.stdout.write(`${key}\n`);
}
