import { createRoot } from "react-dom/client";
import { App } from "./App";

// Styles
import "./styles/base.css";
import "./design-system/tokens.css";
import "./styles/pulse-skin.css";
import "./styles/checkout.css";
import "./styles/enterprise.css";
import "./styles/animations.css";
import "./styles/continuum.css";
import "./styles/polish.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
