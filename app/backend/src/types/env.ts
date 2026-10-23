import { z } from "zod";
import { validateVapidKey } from "../util/commandvalidator";

export interface Env {
  DEVICES: KVNamespace;
  VAPID_KEY: string;
  SUB: string;
  CORS?: string;
  SENDKEY?: string;
  LOGINKEY?: string;
  ASSETS?: Fetcher;
}

export const EnvValidator = z.object({
  VAPID_KEY: z.string().refine(validateVapidKey),
  SUB: z.string().startsWith("mailto:"),
  CORS: z.string().optional(),
  SENDKEY: z.string().optional(),
  LOGINKEY: z.string().optional(),
});
