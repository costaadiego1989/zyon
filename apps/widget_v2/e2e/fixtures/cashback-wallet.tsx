import { createRoot } from "react-dom/client";
import { CashbackWallet } from "../../../storefront/src/components/buyer-hub/CashbackWallet";

document.body.style.cssText = "margin:0;padding:24px;box-sizing:border-box;background:#fafafa;color:#18181b;font:14px system-ui;--aacp-fg:#18181b;--aacp-muted:#52525b;--aacp-line:#d4d4d8;--aacp-surface-2:#e4e4e7;--aacp-accent-text:#0f766e;";
createRoot(document.getElementById("root")!).render(<main style={{ maxWidth: 760, margin: "auto" }}><CashbackWallet merchantId="merchant" /></main>);
