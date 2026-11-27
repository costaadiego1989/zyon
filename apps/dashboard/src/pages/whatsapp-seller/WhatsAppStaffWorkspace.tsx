import React from "react";
import { LogOut, MessageCircle } from "lucide-react";
import { Button } from "../../components/Button.js";
import { PageHeader } from "../../components/PageHeader.js";
import { TabBar } from "../../components/TabBar.js";
import type { ConversationContext } from "./conversation-types.js";
import { WhatsAppConversationsTab } from "./WhatsAppConversationsTab.js";
import { useWhatsAppRoute } from "./useWhatsAppRoute.js";
import type { ConversationNavigation } from "./useConversationNavigation.js";
import "./whatsapp-seller.css";

interface Props { context: ConversationContext; apiBaseUrl: string; onLogout: () => void; busy?: boolean; navigation?: ConversationNavigation }
export function WhatsAppStaffWorkspace(props: Props) {
  if (props.context.role !== "STAFF") return <p role="alert">Acesso ao atendimento indisponível.</p>;
  return <StaffWorkspace {...props} />;
}
function StaffWorkspace(props: Props) {
  const route = useWhatsAppRoute(props.context.role, props.navigation);
  return <main className="dashboard-ui page-container whatsapp-seller whatsapp-staff-workspace">
    <PageHeader title={<span className="whatsapp-staff-workspace__identity"><MessageCircle size={24} strokeWidth={1.6} aria-hidden="true" />WhatsApp</span>} description="Acompanhe as conversas e cuide do atendimento aos clientes."
      actions={<Button variant="outline" disabled={props.busy} onClick={props.onLogout}><LogOut size={15} aria-hidden="true" />Sair</Button>} />
    <TabBar tabs={[{ key: "conversations", label: "Conversas", panelId: "whatsapp-conversations", icon: <MessageCircle size={16} /> }]} activeTab={route.allowed ? "conversations" : ""}
      label="WhatsApp" onTabChange={() => route.navigate("conversations")} />
    {route.allowed && route.tab === "conversations" ? <WhatsAppConversationsTab apiBaseUrl={props.apiBaseUrl} context={props.context} navigation={props.navigation}
      ticketId={route.ticketId} onSelectTicket={id => route.navigate("conversations", id)} onCloseTicket={() => route.navigate("conversations")} />
      : <div className="panel-error" role="alert"><p>Esta opção não está disponível para seu perfil.</p>
        <Button variant="outline" onClick={() => route.navigate("conversations")}>Abrir Conversas</Button></div>}
  </main>;
}
