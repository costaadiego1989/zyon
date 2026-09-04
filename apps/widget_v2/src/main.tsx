import { createRoot } from "react-dom/client";
import { App } from "./App";

import "./styles/base.css";
import "./design-system/tokens.css";
import "./styles/pulse-skin.css";
import "./styles/checkout.css";
import "./styles/enterprise.css";
import "./styles/animations.css";
import "./styles/continuum.css";
import "./styles/polish.css";

import { InlineCheckout } from "./InlineCheckout";

const root = document.getElementById("root");
if (root) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("embed") === "1") {
    createRoot(root).render(
      <InlineCheckout
        embedToken={params.get("embedToken") || ""}
        merchantId={params.get("merchantId") || ""}
        apiBaseUrl={params.get("apiBaseUrl") || "http://127.0.0.1:5174"}
        cartRef={params.get("cartRef") || undefined}
        globalUserId={params.get("globalUserId") || undefined}
        theme={(params.get("theme") as "dark" | "light") || undefined}
      />
    );
  } else {
    createRoot(root).render(<App />);
  }
}
