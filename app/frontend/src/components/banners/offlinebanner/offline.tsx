import type { FunctionalComponent } from "preact";
import style from "./offline.module.css";

const OfflineBanner: FunctionalComponent = () => (
    <div class={style.offline}>Offline</div>
);
export default OfflineBanner;
