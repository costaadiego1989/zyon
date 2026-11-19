import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, MessageSquareText, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "../../components/Button.js";
import { useApi } from "../../hooks/useApi.js";
import { useSupportSocket } from "../../hooks/useSupportSocket.js";
import { canUseWhatsAppConversations } from "../../lib/auth/permissions.js";
import { useWhatsAppConversations } from "./useWhatsAppConversations.js";
import { WhatsAppConversationDrawer } from "./components/WhatsAppConversationDrawer.js";
import type { ConversationContext } from "./conversation-types.js";
import type { ConversationNavigation } from "./useConversationNavigation.js";
import "./whatsapp-seller.css";

interface Props {
  apiBaseUrl: string;
  navigation?: ConversationNavigation;
  context?: ConversationContext | null;
  expectedMerchantId?: string;
  ticketId: string | null;
  onSelectTicket: (id: string) => void;
  onCloseTicket: () => void;
}
const modes: Record<string, string> = { waiting_human: "Aguardando atendimento humano", human: "Em atendimento humano", ai: "IA ativa" };

/** Both hosts share the canonical queue. Configuration hooks are never mounted. */
export function WhatsAppConversationsTab(props: Props) {
  const api = useApi();
  const [verified, setVerified] = useState<{ merchantId: string; context: ConversationContext } | null>(null);
  const [contextError, setContextError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (props.context !== undefined) return;
    let active = true; setVerified(null); setContextError(false);
    if (!props.expectedMerchantId) { setContextError(true); return; }
    void api.getWhatsAppConversationContext().then(value => {
      if (!active) return;
      if (value?.merchant_id !== props.expectedMerchantId || typeof value.user_id !== "string" || !value.user_id.trim()
        || !canUseWhatsAppConversations(value.role)) { setContextError(true); return; }
      setVerified({ merchantId: props.expectedMerchantId!, context: { merchant_id: value.merchant_id, user_id: value.user_id, role: value.role } });
    }).catch(() => { if (active) setContextError(true); });
    return () => { active = false; };
  }, [api, props.context, props.expectedMerchantId, attempt]);
  const candidate = props.context !== undefined ? props.context : verified && verified.merchantId === props.expectedMerchantId ? verified.context : null;
  const context = candidate && canUseWhatsAppConversations(candidate.role) && candidate.merchant_id && candidate.user_id ? candidate : null;
  const socket = useSupportSocket(props.apiBaseUrl, context?.merchant_id);
  const vm = useWhatsAppConversations({ context, api, socket });
  const close = useRef(vm.closeDrawer); close.current = vm.closeDrawer;
  const scope = context ? JSON.stringify([context.merchant_id, context.user_id]) : "";
  // The URL is the only selection producer. A row click never calls open().
  useEffect(() => {
    if (scope && props.ticketId) void vm.open(props.ticketId);
    else close.current();
  }, [scope, props.ticketId, vm.open]);

  if (!context) return <section id="whatsapp-conversations" role="tabpanel" aria-labelledby="whatsapp-conversations-tab" className="whatsapp-conversations whatsapp-conversations--access">
    {contextError || props.context === null ? <div className="panel-error" role="alert"><p>Não foi possível verificar seu acesso ao atendimento.</p>
      {props.context === undefined && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button>}</div>
      : <p role="status">Verificando acesso ao atendimento…</p>}
  </section>;
  return <section id="whatsapp-conversations" role="tabpanel" aria-labelledby="whatsapp-conversations-tab" className="whatsapp-conversations" aria-busy={vm.loading}>
    <div className="whatsapp-conversations__heading">
      <div className="whatsapp-conversations__intro"><h2>Conversas</h2><p>Acompanhe a fila, assuma um atendimento e responda no mesmo canal do cliente.</p></div>
      <Button variant="outline" disabled={vm.loading} onClick={() => void vm.reload()}><RefreshCw size={15} aria-hidden="true" />Atualizar conversas</Button>
    </div>
    <div className="whatsapp-conversations__summary">
      <span className="whatsapp-conversations__page-count">{!vm.queue.length && vm.loading ? "Buscando conversas…" : !vm.queue.length && vm.error ? "Fila indisponível" : `${vm.queue.length} ${vm.queue.length === 1 ? "conversa carregada" : "conversas carregadas"}`}</span>
      {vm.connected && <span className="whatsapp-conversations__connection">Conectado ao atendimento</span>}
    </div>
    {!vm.connected && <p className="whatsapp-conversations__notice" role="status"><WifiOff size={16} aria-hidden="true" />Reconectando ao atendimento. O histórico será atualizado quando a conexão voltar.</p>}
    {vm.error && <div className="whatsapp-conversations__error panel-error" role="alert"><p>{vm.error}</p><Button variant="outline" onClick={() => void vm.reload()}>Tentar novamente</Button></div>}
    {vm.loading && <p className="whatsapp-conversations__loading" role="status">Carregando conversas…</p>}
    {vm.loading && vm.queue.length === 0 && <div className="whatsapp-conversations__skeleton" aria-hidden="true">{[0, 1, 2].map(row => <div key={row}><span /><span /></div>)}</div>}
    {!vm.loading && !vm.error && vm.queue.length === 0 && <div className="whatsapp-conversations__empty">
      <MessageSquareText size={28} strokeWidth={1.5} aria-hidden="true" /><h3>Nenhuma conversa na fila</h3>
      <p>Quando um cliente solicitar atendimento humano pelo WhatsApp, a conversa aparecerá aqui.</p>
    </div>}
    {vm.queue.length > 0 && <>
      <div className="whatsapp-conversations__columns" aria-hidden="true"><span>Conversa</span><span>Atendimento</span><span>Recebida em</span><span /></div>
      <ul className="whatsapp-conversations__list" aria-label="Fila de conversas">{vm.queue.map(row => <li key={row.id} aria-current={props.ticketId === row.id ? "true" : undefined}>
        <div className="whatsapp-conversations__request"><span className="whatsapp-conversations__symbol" aria-hidden="true"><MessageSquareText size={18} strokeWidth={1.6} /></span>
          <div className="whatsapp-conversations__preview"><span className="whatsapp-conversations__reference">Conversa #{row.id.slice(-6).toUpperCase()}</span><p>{row.buyerMessage}</p></div>
        </div>
        <span className="whatsapp-conversations__mode" data-mode={row.binding?.mode ?? "unavailable"}>{modes[row.binding?.mode ?? ""] ?? "Vínculo indisponível"}</span>
        <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString("pt-BR")}</time>
        <Button variant="ghost" onClick={() => props.onSelectTicket(row.id)}>Abrir conversa<ArrowRight size={15} aria-hidden="true" /></Button>
      </li>)}</ul>
    </>}
    {vm.cursor && <div className="whatsapp-conversations__pagination"><Button variant="outline" disabled={vm.loading} onClick={() => void vm.loadMore()}>Carregar mais conversas</Button></div>}
    <WhatsAppConversationDrawer context={context} api={api} vm={vm} ticketId={props.ticketId ?? undefined} onClose={props.onCloseTicket} registerNavigationGuard={props.navigation?.register} />
  </section>;
}
