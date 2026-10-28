export const DBNAME = "notify-db";
export const DBVERSION = 1;
// If you run the GUI separate from the API, set VITE_API_BASE at build time
// to the backend origin, e.g. `VITE_API_BASE=http://localhost:8787/api`.
export const APIBASE =
    (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
