import { render } from "preact";
import App from "./components/app";
import "./style/index.css";

const container = document.getElementById("app");
if (!container) {
    throw new Error("Root element #app not found");
}
render(<App />, container);
