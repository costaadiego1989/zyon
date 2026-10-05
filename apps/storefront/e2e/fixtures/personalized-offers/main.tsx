import { useState } from "react";
import { createRoot } from "react-dom/client";
import LoyaltyTab from "../../../src/components/buyer-hub/tabs/LoyaltyTab";
import { useBuyerHub } from "../../../src/lib/viewmodels/useBuyerHub";

function Fixture() {
  const [open, setOpen] = useState(true);
  const [merchantId, setMerchantId] = useState("qa-store");
  const vm = useBuyerHub(open, merchantId);
  return <main>
    <nav><button onClick={() => setOpen(!open)}>{open ? "Fechar conta" : "Abrir conta"}</button>
      <button onClick={() => vm.setActiveTab("loyalty")}>Fidelidade</button>
      <button onClick={() => vm.setActiveTab("profile")}>Perfil</button>
      <button onClick={vm.signOut}>Sair</button>
      <button onClick={() => setMerchantId("another-store")}>Outra loja</button></nav>
    {open && vm.auth && vm.activeTab === "loyalty" && <LoyaltyTab loyalty={vm.loyalty.data} summary={vm.summary.data}
      benefits={vm.benefits.data} discountRules={null} loading={vm.benefits.loading || vm.loyalty.loading}
      benefitsError={vm.benefits.error} onRetryBenefits={() => { void vm.loadBenefits(); }} />}
  </main>;
}
const style = document.createElement("style");
style.textContent = ":root { --aacp-fg:#26332c; --aacp-muted:#59665e; --aacp-accent:#397456; --aacp-accent-text:#305f45; --aacp-line:#d5dcd6; --aacp-surface:#f5f7f2; --aacp-surface-2:#edf1eb; --aacp-font:Arial; --aacp-bg:#f5f7f2 } * { box-sizing:border-box } body { margin:0; font-family:Arial; background:var(--aacp-bg); color:var(--aacp-fg) } main { width:min(100%,480px); margin:auto; padding:20px } nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:24px } button { min-height:44px; color:var(--aacp-fg); background:var(--aacp-surface-2); border:1px solid var(--aacp-line); border-radius:12px; padding:8px 12px }";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<Fixture />);
