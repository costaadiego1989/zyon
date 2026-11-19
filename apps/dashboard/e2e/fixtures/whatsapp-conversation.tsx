import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createDashboardApi } from "../../src/api-client.js";
import { useSupportSocket } from "../../src/hooks/useSupportSocket.js";
import { useWhatsAppConversations } from "../../src/pages/whatsapp-seller/useWhatsAppConversations.js";
import { WhatsAppConversationDrawer } from "../../src/pages/whatsapp-seller/components/WhatsAppConversationDrawer.js";
import type { ConversationContext } from "../../src/pages/whatsapp-seller/conversation-types.js";
import { Button } from "../../src/components/Button.js";
import "../../src/styles.css";

// Development-only fixture entry served exclusively by the owned T2 middleware.
// The application receives the real login cookie and minimal context endpoint.
const api = createDashboardApi({ baseUrl: location.origin });
function Fixture() {
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [ticketId, setTicketId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const socket = useSupportSocket(location.origin, context?.merchant_id);
  const vm = useWhatsAppConversations({ context, api, socket });
  useEffect(() => {
    let active = true;
    void (async () => {
      const scenario = new URL(location.href).searchParams.get("scenario") ?? "staff-active";
      if (!["staff-active", "staff-history", "products-inactive", "owner-accepted"].includes(scenario)) throw Error("unknown_fixture_scenario");
      const response = await fetch("/__service/conversations/" + scenario, { method: "POST" });
      if (!response.ok) throw Error("owned_fixture_unavailable");
      const seed = await response.json(); await api.login(seed.email, seed.password);
      const principal = await api.getWhatsAppConversationContext();
      if (active) { setTicketId(seed.ticketId); setContext(principal); }
    })().catch(() => { if (active) setError("Não foi possível abrir o atendimento sintético local."); });
    return () => { active = false; };
  }, []);
  return <main className="dashboard-ui page-container" style={{ maxWidth: 920, margin: "40px auto" }}>
    <p>Aplicação local · Atendimento sintético · Sem conexão com a Meta</p>
    <h1>Atendimento no WhatsApp</h1><p>Prévia do drawer com a API e a autenticação locais. A aba Conversas será integrada na tarefa seguinte.</p>
    {error && <p role="alert">{error}</p>}
    <Button disabled={!context || !ticketId} onClick={() => void vm.open(ticketId)}>Abrir conversa</Button>
    <WhatsAppConversationDrawer context={context} api={api} vm={vm} ticketId={ticketId} />
  </main>;
}
createRoot(document.getElementById("conversation-fixture")!).render(<Fixture />);
