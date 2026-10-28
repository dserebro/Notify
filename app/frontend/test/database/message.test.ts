import FDBFactory from "fake-indexeddb/lib/FDBFactory";
import { beforeEach, describe, expect, it } from "vitest";
import {
    getDatabase,
    getUnreadMessageCount,
    setAllMessagesAsRead,
} from "../../src/database/message";
import { DBNAME, DBVERSION } from "../../src/staticsettings";
import type { MessageType } from "../../src/types/messagetype";

function freshIndexedDB(): void {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
        new FDBFactory();
}

function makeMessage(overrides: Partial<MessageType> = {}): MessageType {
    return {
        title: "hello",
        body: "world",
        icon: "",
        tags: [],
        receivedAt: Date.now(),
        read: false,
        ...overrides,
    };
}

describe("database/message", () => {
    beforeEach(() => {
        freshIndexedDB();
    });

    it("opens the notify-db database at the expected version with the right stores", async () => {
        const db = await getDatabase();
        try {
            expect(db.name).toBe(DBNAME);
            expect(db.version).toBe(DBVERSION);
            const stores = Array.from(db.objectStoreNames).sort();
            expect(stores).toEqual(["messages", "user"]);

            // Transactions let us peek at the keyPath/autoIncrement used
            // by the real upgrade handler, confirming the schema the
            // service worker also opens.
            const tx = db.transaction(["messages", "user"], "readonly");
            expect(tx.objectStore("messages").keyPath).toBe("id");
            expect(tx.objectStore("messages").autoIncrement).toBe(true);
            expect(tx.objectStore("user").keyPath).toBe("id");
            expect(tx.objectStore("user").autoIncrement).toBe(true);
            await tx.done;
        } finally {
            db.close();
        }
    });

    it("inserts a message, reads it back, then deletes it", async () => {
        const db = await getDatabase();
        try {
            const insertedKey = await db.add("messages", makeMessage());
            expect(typeof insertedKey).toBe("number");

            const row = await db.get("messages", insertedKey);
            expect(row).toBeDefined();
            expect(row?.title).toBe("hello");
            expect(row?.body).toBe("world");
            expect(row?.read).toBe(false);

            await db.delete("messages", insertedKey);
            const gone = await db.get("messages", insertedKey);
            expect(gone).toBeUndefined();
        } finally {
            db.close();
        }
    });

    it("setAllMessagesAsRead flips every row's `read` to true", async () => {
        const db = await getDatabase();
        try {
            await db.add("messages", makeMessage({ title: "a" }));
            await db.add("messages", makeMessage({ title: "b" }));
            await db.add("messages", makeMessage({ title: "c", read: true }));

            await setAllMessagesAsRead(db);

            const rows = await db.getAll("messages");
            expect(rows).toHaveLength(3);
            expect(rows.every((m) => m.read)).toBe(true);
        } finally {
            db.close();
        }
    });

    it("getUnreadMessageCount counts only unread rows", async () => {
        const db = await getDatabase();
        await db.add("messages", makeMessage({ read: false }));
        await db.add("messages", makeMessage({ read: false }));
        await db.add("messages", makeMessage({ read: true }));
        db.close();

        // getUnreadMessageCount opens its own database handle; it must
        // see the rows the first handle committed.
        await expect(getUnreadMessageCount()).resolves.toBe(2);
    });
});
