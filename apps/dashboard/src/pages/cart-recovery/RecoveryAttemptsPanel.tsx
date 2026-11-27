import React, { useEffect, useState } from "react";
import { CheckCheck, ChevronRight, Mail, MessageCircle, RefreshCw, ShoppingCart } from "lucide-react";
import { useApi } from "../../hooks/useApi.js";
import { DataPanel } from "../../components/DataPanel.js";
import { SidePanel } from "../../components/SidePanel.js";
import { Button } from "../../components/Button.js";
import { formatWhatsAppPhone } from "../../utils/masks.js";
import type { CartRecoveryAttempt, RecoveryAttemptDetail, RecoveryMessage } from "../../api/endpoints/cart-recovery.js";

export function recoveryStatus(status?: string | null) {
  return ({ accepted: "Enviado ao provedor", sent: "Enviado ao provedor", delivered: "Entregue", read: "Lido",
    recovered: "Recuperado", failed: "Falhou", unknown: "Aguardando confirmação", pending: "Pendente",
    dispatching: "Em processamento", expired: "Expirado", cancelled: "Cancelado", skipped: "Não enviado" } as Record<string, string>)[status ?? ""] ?? "Sem confirmação";
}
export const recoveryDate = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Não confirmado";
const phoneLabel = (value?: string | null) => formatWhatsAppPhone(value).replace(/^\+55 /, "");
const strategyLabel = (strategy: string) => ({ offer_free_shipping: "Frete grátis", personalized_cross_sell: "Produtos complementares", offer_coupon: "Cupom de desconto", escalate_discount: "Desconto", advanced_rule: "Regra avançada" } as Record<string, string>)[strategy] ?? strategy;
const channelLabel = (channel?: string | null) => channel === "email" ? "E-mail" : channel === "whatsapp_template" ? "WhatsApp" : channel === "in_session" ? "Na sessão" : "Sem canal";
const reasonLabel = (reason?: string | null) => {
  const labels: Record<string, string> = {
    whatsapp_contact_unavailable: "Sem telefone autorizado para WhatsApp.", whatsapp_sender_unavailable: "Envio por WhatsApp indisponível.",
    meta_connection_unavailable: "A conexão com a Meta estava indisponível.", approved_template_unavailable: "Modelo de WhatsApp aprovado indisponível.",
    provider_acceptance_unknown: "O provedor ainda não confirmou o resultado do envio.", recovery_no_longer_eligible: "O carrinho deixou de ser elegível para recuperação.",
    contact_window_expired: "A janela de contato expirou.", notification_authority_changed: "As condições ou autorizações de envio mudaram.",
    email_not_configured: "O canal de e-mail não estava configurado.", pre_dispatch_validation_unavailable: "Não foi possível validar o envio.",
  };
  return reason ? labels[reason] ?? "Consulte o código registrado pelo provedor." : null;
};
function Reason({ value, label = "Motivo" }: { value?: string | null; label?: string }) {
  return value ? <p className="recovery-detail-note"><strong>{label}: </strong>{reasonLabel(value)} <code>{value}</code></p> : null;
}
function MessageDetail({ message }: { message: RecoveryMessage }) {
  return <section className="recovery-message-detail" aria-label={`Mensagem por ${channelLabel(message.channel)}`}>
    <div className="recovery-message-heading"><h3>{channelLabel(message.channel)}</h3><span className="recovery-delivery" data-status={message.status}>{recoveryStatus(message.status)}</span></div>
    <dl className="recovery-detail-fields"><div><dt>Destinatário no envio</dt><dd>{message.channel === "whatsapp_template" ? phoneLabel(message.recipient) : message.recipient}</dd></div>
      {message.subject && <div><dt>Assunto</dt><dd>{message.subject}</dd></div>}</dl>
    <p className="recovery-message-body">{message.body}</p>
    <ol className="recovery-timeline">
      <li><span>Preparada</span><time>{recoveryDate(message.created_at)}</time></li>
      <li><span>Enviada ao provedor</span><time>{recoveryDate(message.sent_at)}</time></li>
      <li><span>Entrega</span><time>{message.delivered_at ? recoveryDate(message.delivered_at) : message.read_at ? "Confirmada pela leitura" : message.channel === "email" ? "Confirmação indisponível neste canal" : "Ainda sem confirmação"}</time></li>
      <li><span>{message.channel === "email" ? "Abertura" : "Leitura"}</span><time>{message.channel === "email" ? "Rastreamento de abertura indisponível" : message.read_at ? recoveryDate(message.read_at) : "Ainda sem confirmação"}</time></li>
      {message.failed_at && <li><span>Falha informada</span><time>{recoveryDate(message.failed_at)}</time></li>}
    </ol>
    <Reason value={message.reason} />
    {message.template && <p className="recovery-detail-note">Modelo: <code>{message.template}</code></p>}
    {message.provider_message_id && <p className="recovery-detail-note">ID no provedor: <code>{message.provider_message_id}</code></p>}
  </section>;
}

export function RecoveryAttemptsPanel() {
  const api = useApi();
  const [page, setPage] = useState(1), [status, setStatus] = useState(""), [channel, setChannel] = useState("");
  const [version, setVersion] = useState(0), [data, setData] = useState<{ data: CartRecoveryAttempt[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [selected, setSelected] = useState<CartRecoveryAttempt | null>(null);
  const [detail, setDetail] = useState<RecoveryAttemptDetail | null>(null), [detailError, setDetailError] = useState(false);
  useEffect(() => {
    let current = true; setLoading(true); setError(false);
    api.getCartRecoveryAttemptPage(10, (page - 1) * 10, status, channel).then(result => {
      if (!current) return;
      if (page > 1 && result.total <= (page - 1) * 10) { setPage(Math.max(1, Math.ceil(result.total / 10))); return; }
      setData(result);
    }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, page, status, channel, version]);
  useEffect(() => {
    let current = true; setDetail(null); setDetailError(false);
    if (selected) api.getCartRecoveryAttempt(selected.id).then(result => { if (current) setDetail(result); })
      .catch(() => { if (current) setDetailError(true); });
    return () => { current = false; };
  }, [api, selected, version]);
  return <>
    <DataPanel title="Tentativas recentes" page={page} pageSize={10} total={error || loading ? 0 : data.total} onPageChange={setPage}
      trailing={<Button variant="ghost" size="sm" onClick={() => setVersion(v => v + 1)} disabled={loading}><RefreshCw size={14} /> Atualizar</Button>}
      isEmpty={false}
      empty={{ icon: ShoppingCart, title: "Nenhuma tentativa encontrada", description: "As tentativas de recuperação aparecerão aqui. Revise os filtros para consultar outros resultados." }}>
      <div className="recovery-attempt-filters">
        <label>Status<select aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Todos os status</option>
          <option value="sent">Enviados ao provedor</option><option value="recovered">Recuperados</option><option value="pending">Pendentes</option><option value="unknown">Aguardando confirmação</option><option value="failed">Falhas</option><option value="expired">Expirados</option></select></label>
        <label>Canal<select aria-label="Canal" value={channel} onChange={e => { setChannel(e.target.value); setPage(1); }}><option value="">Todos os canais</option><option value="whatsapp_template">WhatsApp</option><option value="email">E-mail</option></select></label>
      </div>
      {loading ? <p role="status" className="recovery-attempt-feedback">Carregando tentativas…</p> : error ? <div role="alert" className="recovery-attempt-feedback">Não foi possível carregar as tentativas. <Button variant="outline" size="sm" onClick={() => setVersion(v => v + 1)}>Tentar novamente</Button></div> : data.total === 0 ? <p className="recovery-attempt-feedback">Nenhuma tentativa encontrada. As tentativas aparecerão aqui conforme os envios ocorrerem. Revise os filtros para consultar outros resultados.</p> : <div className="recovery-attempts-scroll"><table className="recovery-attempt-table">
        <thead><tr><th>Cliente</th><th>Contato</th><th>Canal e status</th><th>Data do envio</th><th aria-label="Detalhes"></th></tr></thead>
        <tbody>{data.data.map(a => <tr key={a.id} onClick={() => setSelected(a)}>
          <td><button className="recovery-customer-link" onClick={e => { e.stopPropagation(); setSelected(a); }}>{a.customer?.name || "Cliente não identificado"}</button><small>Sessão {a.session_id.slice(0, 12)}…</small></td>
          <td><span className="recovery-contact"><Mail size={13} aria-hidden="true" />{a.customer?.email || "E-mail não informado"}</span><span className="recovery-contact"><MessageCircle size={13} aria-hidden="true" />{phoneLabel(a.customer?.phone) || "Telefone não informado"}</span>{a.contact_source === "current_profile" && <small>Contato atual · envio histórico sem registro</small>}</td>
          <td><span>{channelLabel(a.channel)}</span><span className="recovery-delivery" data-status={a.delivery_status ?? a.status}>{a.read_at && <CheckCheck size={14} aria-hidden="true" />}{a.status === "recovered" ? "Recuperado" : recoveryStatus(a.delivery_status ?? a.status)}</span></td>
          <td className="recovery-attempt-date">{recoveryDate(a.sent_at ?? a.created_at)}{!a.sent_at && <small>Data da tentativa</small>}</td>
          <td><button className="ui-icon-button" aria-label={`Ver detalhes de ${a.customer?.name || "cliente não identificado"}`} onClick={e => { e.stopPropagation(); setSelected(a); }}><ChevronRight size={18} /></button></td>
        </tr>)}</tbody></table></div>}
    </DataPanel>
    <SidePanel isOpen={!!selected} title="Detalhes da recuperação" subtitle={selected?.customer?.name || "Histórico da tentativa"} onClose={() => setSelected(null)}>
      {selected && <div className="recovery-attempt-detail">
        <dl className="recovery-detail-fields"><div><dt>E-mail {selected.contact_source === "current_profile" ? "atual" : "registrado"}</dt><dd>{selected.customer?.email || "Não informado"}</dd></div><div><dt>Telefone {selected.contact_source === "current_profile" ? "atual" : "registrado"}</dt><dd>{phoneLabel(selected.customer?.phone) || "Não informado"}</dd></div></dl>
        {detailError ? <div role="alert">Não foi possível carregar os detalhes. <Button onClick={() => setVersion(v => v + 1)}>Tentar novamente</Button></div> : !detail ? <p role="status">Carregando detalhes…</p> : <>
          <dl className="recovery-detail-fields"><div><dt>Resultado da recuperação</dt><dd>{recoveryStatus(detail.status)}</dd></div><div><dt>Estratégia</dt><dd>{strategyLabel(detail.strategy)}</dd></div><div><dt>Tentativa criada</dt><dd>{recoveryDate(detail.created_at)}</dd></div><div><dt>Última atividade antes do envio</dt><dd>{detail.last_activity_at ? recoveryDate(detail.last_activity_at) : "Não registrada"}</dd></div></dl>
          <Reason value={detail.fallback_reason} label="Motivo do uso de e-mail" /><Reason value={detail.reason} />
          <h3 className="recovery-detail-title">Primeiro contato</h3>
          {detail.messages.filter(m => m.correlation_id === detail.id).map(m => <MessageDetail key={m.id} message={m} />)}
          {!detail.messages.some(m => m.correlation_id === detail.id) && <p className="recovery-detail-note">Esta tentativa é anterior ao histórico detalhado. O conteúdo e o destinatário do envio não foram registrados. Entrega e leitura não podem ser confirmadas.</p>}
          {detail.follow_ups.length > 0 && <h3 className="recovery-detail-title">Lembretes</h3>}
          {detail.follow_ups.map(f => <section className="recovery-follow-up" key={f.id}><div className="recovery-message-heading"><h4>Lembrete {f.step}</h4><span>{recoveryStatus(f.status)}</span></div><p className="recovery-detail-note">Agendado para {recoveryDate(f.due_at)}{f.sent_at ? ` · enviado ${recoveryDate(f.sent_at)}` : ""}</p><Reason value={f.reason} /><Reason value={f.fallback_reason} label="Motivo do uso de e-mail" />{detail.messages.filter(m => m.correlation_id === f.id).map(m => <MessageDetail key={m.id} message={m} />)}</section>)}
          {detail.recovered_at && <p className="recovery-detail-note">Carrinho recuperado em {recoveryDate(detail.recovered_at)}{detail.recovered_order_id ? ` · Pedido ${detail.recovered_order_id}` : ""}</p>}
          <p className="recovery-detail-note">A ausência de confirmação de leitura não significa que a mensagem não foi lida.</p>
          <details className="recovery-identifiers"><summary>Identificadores da tentativa</summary><dl className="recovery-detail-fields"><div><dt>Tentativa</dt><dd>{detail.id}</dd></div><div><dt>Sessão</dt><dd>{detail.session_id}</dd></div>{detail.provider_message_id && <div><dt>Mensagem no provedor</dt><dd>{detail.provider_message_id}</dd></div>}</dl></details>
        </>}
      </div>}
    </SidePanel>
  </>;
}
