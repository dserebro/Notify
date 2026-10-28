// Vitest setup for the frontend workspace. Keep it minimal: only add a
// polyfill when a test needs it, so individual tests stay self-explanatory.
//
// fake-indexeddb/auto installs an in-memory IndexedDB implementation on
// `globalThis` (indexedDB, IDBKeyRange, …). The `idb` wrapper used by
// `database/message.ts` reaches straight for these globals, so loading
// this file once at startup is enough.
import "fake-indexeddb/auto";
