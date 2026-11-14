import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ConversationsTab from "../../../src/components/buyer-hub/tabs/ConversationsTab";
import { useBuyerHub } from "../../../src/lib/viewmodels/useBuyerHub";
import { rememberConversationAccess } from "../../../src/lib/conversation-access";
import { validateCurrentBuyerConversation } from "../../../src/lib/services/resume-buyer-conversation.service";

function Fixture() {
  const [open, setOpen] = useState(true);
  const [merchantId, setMerchantId] = useState("store-1");
  const vm = useBuyerHub(open, merchantId);
  useEffect(() => {
    rememberConversationAccess("current", `${btoa(JSON.stringify({ origin: window.location.origin, expiresAt: Date.now() / 1000 + 3600 }))}.signature`);
    vm.setActiveTab("conversations");
  }, []);
  return <main>
    <nav><button onClick={() => setOpen(!open)}>{open ? "Fechar conta" : "Abrir conta"}</button>
      <button onClick={() => setMerchantId("store-2")}>Outra loja</button><button onClick={vm.signOut}>Sair</button></nav>
    {open && vm.auth && <ConversationsTab conversations={vm.conversations.data ?? []} loading={vm.conversations.loading} error={vm.conversations.error}
      merchantId={merchantId} currentSessionId="current" onRate={vm.rateMessage} onRetry={() => { void vm.loadConversations(); }}
      onResume={async (conversation) => { await validateCurrentBuyerConversation(conversation, merchantId, "current"); setOpen(false); }} />}
    {!open && <section aria-label="Chat atual"><p>Mensagem preservada no atendimento atual</p><input aria-label="Mensagem" /></section>}
  </main>;
}
const style = document.createElement("style");
style.textContent = ":root { --aacp-fg:#26332c; --aacp-muted:#59665e; --aacp-accent:#397456; --aacp-accent-text:#305f45; --aacp-line:#d5dcd6; --aacp-surface-2:#edf1eb; --aacp-surface-3:#e3e9e1; --aacp-panel-bg:#fff; --aacp-success:#397456; --aacp-bg:#f5f7f2 } * { box-sizing:border-box } body { margin:0; font-family:Arial; background:var(--aacp-bg); color:var(--aacp-fg) } main { width:min(100%,480px); margin:auto; padding:20px } nav { display:flex; gap:8px; margin-bottom:24px } button { min-height:44px; color:var(--aacp-fg); border:1px solid var(--aacp-line); border-radius:999px; padding:8px 12px }";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<Fixture />);
