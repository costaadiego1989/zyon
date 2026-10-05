import { useState } from "react";
import { createRoot } from "react-dom/client";
import LoyaltyTab, { type LoyaltyCartSnapshot } from "../../../src/components/buyer-hub/tabs/LoyaltyTab";
import { BuyerHubPanel } from "../../../src/components/buyer-hub/BuyerHubPanel";
import { useBuyerHub } from "../../../src/lib/viewmodels/useBuyerHub";
import type { DiscountRule } from "../../../src/lib/viewmodels/useBuyerHub/types";
import { THEME_TOKENS } from "../../../src/components/conversation/theme-tokens";

declare global {
  interface Window { __loyaltyCartSnapshot?: LoyaltyCartSnapshot; __loyaltyCoupons?: DiscountRule[] }
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [merchantId, setMerchantId] = useState("qa-store");
  const vm = useBuyerHub(open, merchantId);
  const params = new URLSearchParams(window.location.search);
  if (params.has("hub")) return <BuyerHubPanel isOpen={open} onClose={() => setOpen(false)} merchantId={merchantId}
    merchantSlug={params.has("missingSlug") ? undefined : "athom-teste"} />;
  return <main>
    <nav><button onClick={() => setOpen(!open)}>{open ? "Fechar conta" : "Abrir conta"}</button>
      <button onClick={() => vm.setActiveTab("loyalty")}>Fidelidade</button>
      <button onClick={() => vm.setActiveTab("profile")}>Perfil</button>
      <button onClick={vm.signOut}>Sair</button>
      <button onClick={() => setMerchantId("another-store")}>Outra loja</button></nav>
    {open && vm.auth && vm.activeTab === "loyalty" && <LoyaltyTab loyalty={vm.loyalty.data} summary={vm.summary.data}
      benefits={vm.benefits.data} discountRules={window.__loyaltyCoupons ?? null} cartSnapshot={window.__loyaltyCartSnapshot}
      loading={vm.benefits.loading || vm.loyalty.loading}
      benefitsError={vm.benefits.error} onRetryBenefits={() => { void vm.loadBenefits(); }} />}
  </main>;
}
const style = document.createElement("style");
style.textContent = ":root { --aacp-accent:#397456; --aacp-font:Arial } * { box-sizing:border-box } body { margin:0; font-family:Arial; background:var(--aacp-bg); color:var(--aacp-fg) } main { width:min(100%,480px); margin:auto; padding:20px } nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:24px } nav button { min-height:44px; color:var(--aacp-fg); background:var(--aacp-surface-2); border:1px solid var(--aacp-line); border-radius:12px; padding:8px 12px }";
document.head.append(style);
const theme = localStorage.getItem("zyon-theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
for (const [key, value] of Object.entries(THEME_TOKENS[theme])) document.documentElement.style.setProperty(key, value);
createRoot(document.getElementById("root")!).render(<Fixture />);
