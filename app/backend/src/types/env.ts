export interface Env {
  DEVICES: KVNamespace;
  VAPID_KEY: string;
  SUB: string;
  CORS?: string;
  SENDKEY?: string;
  LOGINKEY?: string;
  ASSETS?: Fetcher;
}