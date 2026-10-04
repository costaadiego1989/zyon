import React, { useCallback, useEffect, useRef, useState } from "react";
import { Send, MessageSquare, Store } from "lucide-react";
import { Modal } from "../../../components/Modal.js";
import { FormTextarea } from "../../../components/FormField.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { PageLoader } from "../../../components/PageLoader.js";
import type { SupportTicketStatus, SupportRefundPreview } from "@zyon/shared-types";
import { Button } from "../../../components/Button.js";
import { useSupportChat } from "../hooks/useSupportChat.js";
import type { TicketMessage } from "../../../hooks/useSupportSocket.js";
import { PartnerStoreDropdown } from "./PartnerStoreDropdown.js";
import "../support-case.css";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;
interface SupportChatDrawerProps {
  ticketId: string; connected: boolean; busy: boolean; actionError: string | null;
  onStatus: (status: SupportTicketStatus) => void; statusOptions: Array<{ value: SupportTicketStatus; label: string }>;
  buyerMessage: string; status: string; api: DashboardApi; onClose: () => void;
  onSend: (ticketId: string, content: string) => void; onJoin: (ticketId: string) => void;
  onLeave: (ticketId: string) => void; onNewMessage: (handler: (msg: TicketMessage) => void) => () => void;
}
const money = (cents: number, currency = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
const returnLabels: Record<string, string> = { REQUESTED: "Aguardando análise", LABEL_GENERATED: "Envio autorizado", SHIPPED: "Em trânsito", RECEIVED: "Recebido para análise", INSPECTED_PASS: "Análise aprovada", INSPECTED_FAIL: "Análise em revisão", REFUND_PROCESSING: "Estorno em processamento", REFUND_COMPLETED: "Estorno concluído", EXCHANGE_COMPLETED: "Troca concluída", REJECTED: "Solicitação não aprovada", CANCELLED: "Cancelada" };
function friendlyError(error: unknown) {
  const message = error && typeof error === "object" && "responseBody" in error ? String(error.responseBody) : error instanceof Error ? error.message : "Não foi possível concluir a ação.";
  const labels: Record<string, string> = { refund_item_price_unavailable: "Este pedido não tem preços históricos suficientes. Confira os itens antes de qualquer estorno.", invalid_order_item: "Há itens antigos sem identificação. Confirme com o cliente quais itens estão envolvidos.", manual_refund_required: "Este meio de pagamento exige conciliação manual. O caso continuará aberto.", refund_preview_changed: "O saldo mudou. Consulte a prévia novamente antes de confirmar.", case_cannot_change_during_refund: "Já existe um estorno em processamento. Confira o resultado antes de alterar o caso.", resolve_return_before_closing_ticket: "Conclua a devolução ou troca antes de resolver o chamado.", item_not_in_order: "A solicitação contém um item que não pertence ao pedido. Confira com o cliente.", invalid_return_quantity: "A quantidade solicitada não é válida para este pedido." };
  return Object.entries(labels).find(([key]) => message.includes(key))?.[1] ?? message;
}
export function SupportChatDrawer(props: SupportChatDrawerProps) {
  const { ticketId, api, onClose, onJoin, onLeave, onNewMessage } = props;
  const { detail, messages, loading, error, reload } = useSupportChat(api, ticketId);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [preview, setPreview] = useState<SupportRefundPreview | null>(null);
  const [action, setAction] = useState("");
  const [notes, setNotes] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [replacementOrderId, setReplacementOrderId] = useState("");
  const [condition, setCondition] = useState("GOOD");
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);
  const [confirmedItems, setConfirmedItems] = useState<Record<string, number>>({});
  const [isMarketplaceOrigin, setIsMarketplaceOrigin] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferredTo, setTransferredTo] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messageKey = useRef<string>();
  const status = detail?.status ?? props.status;
  const busy = sending || actionBusy || props.busy;
  const active = detail ? detail.active : !["closed", "resolved"].includes(status);
  const returnStatus = detail?.returnStatus;
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => { onJoin(ticketId); return () => onLeave(ticketId); }, [ticketId, onJoin, onLeave]);
  useEffect(() => onNewMessage(message => { if (message.ticketId === ticketId) void reloadRef.current(); }), [ticketId, onNewMessage]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [messages.at(-1)?.id]);
  useEffect(() => { let cancelled = false; void api.getTicketMarketplaceOrigin(ticketId).then(result => { if (!cancelled) setIsMarketplaceOrigin(result.isMarketplaceOrigin); }).catch(() => undefined); return () => { cancelled = true; }; }, [api, ticketId]);
  function close() { if (busy) return; if (input.trim() || notes.trim()) setConfirmClose(true); else onClose(); }
  async function send() {
    const content = input.trim(); if (!content || busy) return;
    setSending(true); setLocalError(null);
    const key = messageKey.current ?? crypto.randomUUID(); messageKey.current = key;
    try { await api.sendTicketMessage(ticketId, content, key); setInput(""); messageKey.current = undefined; await reload(); }
    catch (e) { setLocalError(friendlyError(e)); }
    finally { setSending(false); }
  }
  async function run(work: () => Promise<unknown>) {
    if (busy) return; setActionBusy(true); setLocalError(null);
    try { await work(); await reload(); }
    catch (e) { setLocalError(friendlyError(e)); }
    finally { setActionBusy(false); }
  }
  const confirmAction = useCallback(async () => {
    await api.supportCaseAction(ticketId, { action, notes: notes.trim(), labelUrl: labelUrl.trim() || undefined, trackingCode: trackingCode.trim() || undefined, replacementOrderId: replacementOrderId.trim() || undefined, itemCondition: condition, deliveryConfirmed, ...(action === "confirm_items" ? { items: Object.entries(confirmedItems).filter(([, quantity]) => quantity > 0).map(([variantId, quantity]) => ({ variantId, quantity })) } : {}) });
    setAction(""); setNotes(""); setTrackingCode(""); setLabelUrl(""); setReplacementOrderId(""); setDeliveryConfirmed(false);
  }, [api, ticketId, action, notes, labelUrl, trackingCode, replacementOrderId, condition, deliveryConfirmed, confirmedItems]);
  const actionLabels: Record<string, string> = { confirm_items: "Confirmar itens com o cliente", authorize_return: "Autorizar envio dos itens", received: "Registrar recebimento", inspection_pass: "Aprovar análise dos itens", reject: "Não aprovar solicitação", complete_exchange: "Registrar troca concluída" };
  return <Modal isOpen title={`Chamado #${ticketId.slice(-6).toUpperCase()}`} subtitle="Pedido, evidências e decisões acompanham a conversa com o cliente." presentation="center" size="xl" onClose={close} footer={confirmClose ? <div className="support-chat__close"><p>Há uma mensagem ou decisão ainda não enviada.</p><Button variant="outline" onClick={() => setConfirmClose(false)}>Continuar editando</Button><Button variant="danger" onClick={onClose}>Descartar e fechar</Button></div> : <div className="support-chat__footer">{active ? <><FormTextarea label="Sua resposta ao cliente" value={input} onChange={setInput} maxLength={4000} rows={2} disabled={busy} placeholder="Escreva para o cliente…" hint="A mensagem será salva no histórico e ficará disponível no hub do cliente." /><Button variant="primary" disabled={!input.trim() || busy || loading || !detail} onClick={() => void send()}><Send size={16} />{sending ? "Enviando…" : "Enviar resposta"}</Button></> : <p>Atendimento concluído. O histórico permanece disponível para a loja e o cliente.</p>}</div>}>
    <div className="support-case configuration-form">
      <section className="support-case__conversation" aria-label="Conversa com o cliente">
        <div className="support-chat__status"><span className={`badge ${active ? "warn" : "ok"}`}>{returnStatus ? returnLabels[returnStatus] ?? returnStatus : status === "open" ? "Aberto" : active ? "Em atendimento" : "Concluído"}</span><span className="muted">{props.connected ? "Atualizações em tempo real" : "Histórico sincronizado automaticamente"}</span></div>
        {(localError || props.actionError) && <div className="panel-error" role="alert">{localError || props.actionError}</div>}
        {props.statusOptions.length > 0 && <div className="support-chat__actions">{props.statusOptions.filter(option => !detail?.returnId || option.value === "in_progress" || !detail.active).map(option => <Button key={option.value} variant="outline" size="sm" disabled={busy} onClick={() => props.onStatus(option.value)}>{option.value === "in_progress" ? "Iniciar atendimento" : option.value === "resolved" ? "Resolver atendimento" : "Fechar atendimento"}</Button>)}</div>}
        {loading ? <PageLoader /> : error ? <EmptyState icon={MessageSquare} title="Não foi possível atualizar a conversa" description={error} action={<Button variant="outline" onClick={() => void reload()}>Tentar novamente</Button>} /> : null}
        <div className="support-chat__messages" aria-live="polite">
          {!loading && !messages.length && props.buyerMessage && <div className="support-msg support-msg--buyer"><span className="support-msg-label">Mensagem de abertura do cliente</span><p>{props.buyerMessage}</p></div>}
          {messages.map(message => <div key={message.id} className={`support-msg support-msg--${message.senderType}`}><span className="support-msg-label">{message.senderType === "buyer" ? "Cliente" : message.senderType === "merchant" ? "Loja" : "Atualização do atendimento"}</span><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.content}</p>{message.metadata?.imageUrls?.length ? <div className="support-case__photos">{message.metadata.imageUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`Evidência do cliente ${index + 1}`} loading="lazy" /></a>)}</div> : null}<time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time></div>)}<div ref={bottom} />
        </div>
      </section>
      <aside className="support-case__context" aria-label="Dados do pedido e resolução">
        {detail?.returnId ? <><h3>{detail.kind === "exchange" ? "Troca solicitada" : "Devolução solicitada"}</h3><dl className="support-case__facts"><dt>Pedido</dt><dd>{detail.orderId}</dd><dt>Compra</dt><dd>{detail.order?.completedAt ? new Date(detail.order.completedAt).toLocaleString("pt-BR") : "Data não disponível"}</dd><dt>Total pago</dt><dd>{detail.order ? money(detail.order.totalCents, detail.order.currency) : "A conferir"}</dd><dt>Pagamento</dt><dd>{detail.order?.paymentMethod ?? "Não informado"}</dd><dt>Motivo</dt><dd>{detail.reasonLabel ?? detail.reason}</dd></dl><h4>Itens desta solicitação</h4><ul className="support-case__items">{detail.selectedItems.map(item => <li key={item.variantId}><strong>{item.quantity} × {item.name}</strong><span>{detail.order?.items.find(line => line.variantId === item.variantId) ? money(detail.order.items.find(line => line.variantId === item.variantId)!.unitPriceCents, detail.order.currency) + " / unidade" : "Identificação e preço a conferir"}</span></li>)}</ul><details><summary>Todos os itens do pedido</summary><ul>{detail.order?.items.map(item => <li key={item.variantId}>{item.quantity} × {item.name}</li>)}</ul></details>{detail.notes && <><h4>Relato do cliente</h4><p style={{ whiteSpace: "pre-wrap" }}>{detail.notes}</p></>}{detail.imageUrls.length > 0 && <><h4>Fotos enviadas</h4><div className="support-case__photos">{detail.imageUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`Foto da solicitação ${index + 1}`} loading="lazy" /></a>)}</div></>}
        {detail.refund && <div className="support-case__notice" role="status"><strong>{detail.refund.status === "COMPLETED" ? "Estorno confirmado" : detail.refund.status === "FAILED" ? "Estorno não concluído" : "Estorno aguardando confirmação"}</strong><p>{money(detail.refund.amountInCents, detail.order?.currency)}{detail.refund.providerRefundId ? ` · Referência ${detail.refund.providerRefundId}` : " · A conciliação continua em andamento"}</p>{detail.refund.status !== "COMPLETED" && detail.canRefund && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api.confirmSupportRefund(ticketId, detail.refund!.amountInCents))}>Consultar resultado do estorno</Button>}</div>}
        {active && !detail.refund && <><h4>Próximo passo</h4><p className="muted">As instruções e decisões abaixo serão enviadas ao cliente nesta conversa.</p><div className="support-case__actions">{detail.order && ["REQUESTED", "RECEIVED", "INSPECTED_PASS", "REFUND_PROCESSING"].includes(returnStatus ?? "") && <Button variant="outline" disabled={busy} onClick={() => { setPreview(null); setConfirmedItems(Object.fromEntries(detail.selectedItems.filter(item => detail.order!.items.some(line => line.variantId === item.variantId)).map(item => [item.variantId, item.quantity]))); setAction("confirm_items"); }}>Confirmar itens com o cliente</Button>}{returnStatus === "REQUESTED" && <Button variant="outline" disabled={busy} onClick={() => setAction("authorize_return")}>Autorizar envio dos itens</Button>}{["LABEL_GENERATED", "SHIPPED"].includes(returnStatus ?? "") && <Button variant="outline" disabled={busy} onClick={() => setAction("received")}>Registrar recebimento</Button>}{returnStatus === "RECEIVED" && <Button variant="outline" disabled={busy} onClick={() => setAction("inspection_pass")}>Aprovar análise</Button>}{["REQUESTED", "RECEIVED", "INSPECTED_FAIL"].includes(returnStatus ?? "") && <Button variant="outline" disabled={busy} onClick={() => setAction("reject")}>Não aprovar solicitação</Button>}{detail.kind === "exchange" && ["REQUESTED", "INSPECTED_PASS"].includes(returnStatus ?? "") && <Button variant="outline" disabled={busy} onClick={() => setAction("complete_exchange")}>Registrar troca concluída</Button>}{detail.kind === "refund" && detail.canRefund && ["REQUESTED", "INSPECTED_PASS", "REFUND_PROCESSING"].includes(returnStatus ?? "") && <Button variant="primary" disabled={busy} onClick={() => void run(async () => { const value = await api.getSupportRefundPreview(ticketId); setPreview(value); setAction(""); })}>{actionBusy ? "Consultando…" : "Conferir e aprovar estorno"}</Button>}</div>
        {action && <div className="support-case__decision"><h4>{actionLabels[action]}</h4>{action === "confirm_items" && <><p className="muted">Confirme os itens e as quantidades na conversa antes de registrar. A seleção ficará documentada para o cliente.</p>{detail.order?.items.map(item => <div className="support-case__check" key={item.variantId}><label><input type="checkbox" disabled={busy || item.eligibleQuantity < 1} checked={(confirmedItems[item.variantId] ?? 0) > 0} onChange={event => setConfirmedItems(current => ({ ...current, [item.variantId]: event.target.checked ? 1 : 0 }))} />{item.name}</label>{(confirmedItems[item.variantId] ?? 0) > 0 && <input type="number" aria-label={`Quantidade de ${item.name}`} min={1} max={item.eligibleQuantity} value={confirmedItems[item.variantId]} onChange={event => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= item.eligibleQuantity) setConfirmedItems(current => ({ ...current, [item.variantId]: quantity })); }} />}</div>)}</>}<FormTextarea label={action === "reject" ? "Explique a decisão ao cliente" : "Mensagem e instruções para o cliente"} value={notes} onChange={setNotes} rows={3} maxLength={3500} disabled={busy} />{action === "authorize_return" && <><label>Link da etiqueta real, se houver<input type="url" value={labelUrl} onChange={event => setLabelUrl(event.target.value)} placeholder="https://…" /></label><label>Código de rastreio, se houver<input value={trackingCode} onChange={event => setTrackingCode(event.target.value)} /></label><p className="muted">Sem etiqueta, informe o endereço e o procedimento de envio. A autorização será registrada na conversa.</p></>}{action === "inspection_pass" && <label>Condição verificada<select value={condition} onChange={event => setCondition(event.target.value)}><option value="NEW">Novo</option><option value="GOOD">Em bom estado</option><option value="DAMAGED">Danificado</option></select></label>}{action === "complete_exchange" && <><label>Referência do pedido de reposição<input value={replacementOrderId} onChange={event => setReplacementOrderId(event.target.value)} /></label><label>Rastreio ou comprovante da entrega<input value={trackingCode} onChange={event => setTrackingCode(event.target.value)} /></label><label className="support-case__check"><input type="checkbox" checked={deliveryConfirmed} onChange={event => setDeliveryConfirmed(event.target.checked)} />Conferi e confirmo que a reposição foi entregue ao cliente.</label><p className="muted">Este registro documenta a entrega conferida pela loja.</p></>}<Button variant={action === "reject" ? "danger" : "primary"} disabled={busy || !notes.trim() || (action === "confirm_items" && !Object.values(confirmedItems).some(quantity => quantity > 0)) || (action === "complete_exchange" && (!replacementOrderId.trim() || !trackingCode.trim() || !deliveryConfirmed))} onClick={() => void run(confirmAction)}>Confirmar e informar cliente</Button><Button variant="outline" disabled={busy} onClick={() => setAction("")}>Cancelar</Button></div>}
        {preview && <div className="support-case__decision"><h4>Confira antes de estornar</h4><ul>{preview.items.map(item => <li key={item.variantId}>{item.quantity} × {item.name}</li>)}</ul><dl className="support-case__facts"><dt>Valor capturado</dt><dd>{money(preview.capturedCents, preview.currency)}</dd><dt>Já estornado ou reservado</dt><dd>{money(preview.reservedCents, preview.currency)}</dd><dt>Saldo disponível</dt><dd>{money(preview.availableCents, preview.currency)}</dd><dt>Meio de pagamento</dt><dd>{preview.paymentMethod ?? preview.provider}</dd><dt>Estorno proposto</dt><dd><strong>{money(preview.amountCents, preview.currency)}</strong></dd></dl><p>{returnStatus === "REQUESTED" ? "Ao confirmar, você aprova a análise e dispensa o envio físico destes itens. " : ""}O estorno será solicitado ao meio de pagamento original. O chamado só será concluído após a confirmação do provedor.</p>{preview.automatic ? <Button variant="danger" disabled={busy} onClick={() => void run(async () => { await api.confirmSupportRefund(ticketId, preview.amountCents); setPreview(null); })}>{actionBusy ? "Solicitando…" : `Confirmar estorno de ${money(preview.amountCents, preview.currency)}`}</Button> : <p role="alert">Este pagamento exige conciliação manual. O caso permanece aberto.</p>}<Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Voltar sem estornar</Button></div>}</>}
        {!active && <p className="support-case__notice">Solicitação concluída. As decisões e evidências ficam preservadas no histórico.</p>}</> : <><h3>Atendimento ao cliente</h3><p className="muted">Responda nesta conversa. Para uma troca ou devolução, o cliente deve escolher o pedido e os itens na própria conta.</p></>}
        {isMarketplaceOrigin && <div className="support-case__transfer">{transferredTo ? <p>Chamado transferido para {transferredTo}</p> : showTransfer ? <PartnerStoreDropdown api={api} ticketId={ticketId} onTransferred={name => { setTransferredTo(name); setShowTransfer(false); }} /> : <Button variant="outline" size="sm" disabled={busy} onClick={() => setShowTransfer(true)}><Store size={14} />Vincular loja parceira</Button>}</div>}
      </aside>
    </div>
  </Modal>;
}
