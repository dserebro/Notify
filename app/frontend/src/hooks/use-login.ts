import { useCallback, useEffect, useState } from "preact/hooks";
import { getDatabase } from "../database/message";
import { checkIfDeviceExists } from "../services/apiservice";
import { LoginStatus, login, logoff } from "../services/loginservice";
import { parseResponse } from "../types/apiresponse";

export function useLogin(): [
    LoginStatus,
    (shouldLogin: boolean, apiKey?: string) => Promise<LoginStatus>,
] {
    const [isLoggedIn, setIsLoggedIn] = useState(LoginStatus.LOGGED_OUT);

    const setLoginState = useCallback(
        async (loginState: boolean, apiKey?: string): Promise<LoginStatus> => {
            if (loginState) {
                const [res, device] = await login(apiKey);
                // clear all users and save the new one if login was successful
                if (device) {
                    const db = await getDatabase();
                    await db.clear("user");
                    await db.add("user", device);
                    db.close();
                }
                // after it was successful saved, set the logged in state
                setIsLoggedIn(res);
                return res;
            } else {
                const res = await logoff();
                setIsLoggedIn(res);
                return res;
            }
        },
        [setIsLoggedIn],
    );

    useEffect(() => {
        const updateFn = async () => {
            const database = await getDatabase();
            const users = await database?.getAll("user");
            database.close();
            if (users[0]?.id) {
                const { id, secret } = users[0];
                const existsResponse = await checkIfDeviceExists(id, secret);
                const exists = parseResponse(existsResponse);
                exists && setIsLoggedIn(LoginStatus.LOGGED_IN);
            } else {
                setIsLoggedIn(LoginStatus.LOGGED_OUT);
            }
        };

        updateFn().catch(() => setIsLoggedIn(LoginStatus.LOGGED_OUT));
    }, [setIsLoggedIn]);

    return [isLoggedIn, setLoginState];
}
