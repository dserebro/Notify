import type { FunctionalComponent } from "preact";
import style from "./update.module.css";

type Props = {
    onUpdate: () => void;
};

const HasUpdateBanner: FunctionalComponent<Props> = ({ onUpdate }) => (
    <button type="button" class={style.updateBanner} onClick={onUpdate}>
        Update Available please reload please this page (click here)
    </button>
);

export default HasUpdateBanner;
