import { FunctionalComponent, h } from "preact";
import { DatabaseProvider } from "../context/database";
import { useOnline } from "../hooks/use-offline";
import Messages from "./messages/messages";
import OfflineBanner from "./banners/offlinebanner/offline";
import NotSupportedBanner from "./banners/notsupportedbanner/notsupported";
import Register from "./register/register";
import style from "./style.module.css";
import { useIsSupported } from "../hooks/use-supported";
import { useAppUpdate } from "../hooks/use-appupdate";
import HasUpdateBanner from "./banners/updatebanner/update";
import KeyWarningBanner from "./banners/keywarning/keywarning";
import { useInvalidKeyDetector } from "../hooks/use-invalidkeydetector";
import { useIsIos } from "../hooks/use-isios";
import IosInstallBanner from "./banners/iosbanner/iosbanner";

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
