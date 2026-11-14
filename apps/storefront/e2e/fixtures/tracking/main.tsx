import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TrackingTab } from "../../../src/components/buyer-hub/tabs/TrackingTab";
import { BuyerHubPanel } from "../../../src/components/buyer-hub/BuyerHubPanel";
import { useBuyerHub } from "../../../src/lib/viewmodels/useBuyerHub";
import { THEME_TOKENS } from "../../../src/components/conversation/theme-tokens";

function Fixture() {
  const [open, setOpen] = useState(true);
  const [merchantId, setMerchantId] = useState("qa-store");
  const vm = useBuyerHub(open, merchantId);
  const fullHub = new URLSearchParams(window.location.search).has("hub");
  useEffect(() => { if (!fullHub) vm.setActiveTab("tracking"); }, [fullHub]);
  if (fullHub) return <BuyerHubPanel isOpen={open} onClose={() => setOpen(false)} merchantId={merchantId} merchantSlug="athom-teste" />;
  return <main>
    <nav aria-label="Controles da fixture local">
      <button onClick={() => setOpen(!open)}>{open ? "Fechar conta" : "Abrir conta"}</button>
      <button onClick={() => setMerchantId("another-store")}>Outra loja</button>
      <button onClick={vm.signOut}>Sair</button>
      <button onClick={() => { void vm.loadTracking(); }}>Atualizar rastreio</button>
    </nav>
    {open && vm.auth && <TrackingTab purchases={vm.tracking.data ?? []} loading={vm.tracking.loading}
      error={vm.tracking.error} onRetry={() => { void vm.loadTracking(); }} />}
  </main>;
}
const style = document.createElement("style");
style.textContent = ":root { --aacp-accent:#397456; --aacp-font:Arial } * { box-sizing:border-box } body { margin:0; font-family:Arial; background:var(--aacp-bg); color:var(--aacp-fg) } main { width:min(100%,480px); margin:auto; padding:20px } nav { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:24px } nav button { min-height:44px; color:var(--aacp-fg); background:var(--aacp-surface-2); border:1px solid var(--aacp-line); border-radius:12px; padding:8px 12px }";
document.head.append(style);
const theme = localStorage.getItem("zyon-theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
for (const [key, value] of Object.entries(THEME_TOKENS[theme])) document.documentElement.style.setProperty(key, value);
createRoot(document.getElementById("root")!).render(<Fixture />);
