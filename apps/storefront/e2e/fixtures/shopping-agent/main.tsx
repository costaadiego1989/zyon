import { createRoot } from "react-dom/client";
import { BuyerHubPanel } from "../../../src/components/buyer-hub/BuyerHubPanel";
import "../../../src/app/globals.css";
import { THEME_TOKENS } from "../../../src/components/conversation/theme-tokens";

document.documentElement.style.setProperty("--aacp-accent", "#14766c");
document.documentElement.style.setProperty("--aacp-on-accent", "#ffffff");
const mode = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
for (const [key, value] of Object.entries(THEME_TOKENS[mode])) document.documentElement.style.setProperty(key, value);
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(<BuyerHubPanel isOpen merchantId="merchant" storeName="Loja de café" theme={mode} onClose={() => {}} />);
