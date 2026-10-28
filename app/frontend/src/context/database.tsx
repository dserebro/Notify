import { type ComponentChildren, createContext } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getDatabase } from "../database/message";
import type { NotifyDatabase } from "../types/dbtypes";

export const DataBaseContext = createContext<NotifyDatabase | undefined>(
    undefined,
);

type Props = { children: ComponentChildren };

export const DatabaseProvider = ({ children }: Props) => {
    const [database, setDb] = useState<NotifyDatabase | undefined>(undefined);

    useEffect(() => {
        getDatabase().then((db: NotifyDatabase) => setDb(db));
    }, [setDb]);

    return (
        <DataBaseContext.Provider value={database}>
            {children}
        </DataBaseContext.Provider>
    );
};
