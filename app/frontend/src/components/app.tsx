import type { FunctionalComponent } from "preact";
import { DatabaseProvider } from "../context/database";
import { useAppUpdate } from "../hooks/use-appupdate";
import { useInvalidKeyDetector } from "../hooks/use-invalidkeydetector";
import { useIsIos } from "../hooks/use-isios";
import { useOnline } from "../hooks/use-offline";
import { useIsSupported } from "../hooks/use-supported";
import IosInstallBanner from "./banners/iosbanner/iosbanner";
import KeyWarningBanner from "./banners/keywarning/keywarning";
import NotSupportedBanner from "./banners/notsupportedbanner/notsupported";
import OfflineBanner from "./banners/offlinebanner/offline";
import HasUpdateBanner from "./banners/updatebanner/update";
import Messages from "./messages/messages";
import Register from "./register/register";
import style from "./style.module.css";

const App: FunctionalComponent = () => {
    const { needRefresh, update } = useAppUpdate();
    const isSupported = useIsSupported();
    const isInvalidKey = useInvalidKeyDetector();
    const isOnline = useOnline();
    const isIos = useIsIos();
    return (
        <div class={style.app}>
            {isSupported || isIos ? (
                <div class={style.content}>
                    <div class={style.header}>
                        {needRefresh && <HasUpdateBanner onUpdate={update} />}
                        {isInvalidKey && <KeyWarningBanner />}
                        {isIos && !isSupported && <IosInstallBanner />}
                        {isOnline ? <Register /> : <OfflineBanner />}
                    </div>
                    <div class={style.main}>
                        <DatabaseProvider>
                            <Messages />
                        </DatabaseProvider>
                    </div>
                </div>
            ) : (
                <NotSupportedBanner />
            )}
        </div>
    );
};

export default App;
