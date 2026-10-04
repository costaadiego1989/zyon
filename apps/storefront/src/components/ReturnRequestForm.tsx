"use client";
import { useEffect, useRef, useState } from "react";
import { eligibleReturnOrders, openReturnCase, returnDraftApi, supportChanged, type ReturnDraft, type SupportOrder, type SupportCaseSummary } from "@/lib/services/support-case.service";
import { SupportPhotoPicker } from "./SupportPhotoPicker";
import styles from "./SupportFlow.module.css";

const reasons = [{ value: "DEFECTIVE", label: "Produto com defeito" }, { value: "WRONG_ITEM", label: "Recebi um item errado" }, { value: "NOT_AS_DESCRIBED", label: "Diferente do anúncio" }, { value: "CHANGED_MIND", label: "Mudei de ideia" }, { value: "DAMAGED_IN_TRANSIT", label: "Danificado no transporte" }, { value: "OTHER", label: "Outro motivo" }];
const money = (cents: number, currency = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
export function ReturnRequestForm({ orderId: initialOrderId, merchantId, onSuccess, onCancel, cases = [] }: { orderId?: string; merchantId: string; onSuccess: (ticketId: string) => void; onCancel: () => void; cases?: SupportCaseSummary[] }) {
  const [orders, setOrders] = useState<SupportOrder[]>([]);
  const [draft, setDraft] = useState<ReturnDraft>({ orderId: initialOrderId ?? "", step: 0, kind: "refund", reason: "", notes: "", requestKey: "", items: {} });
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const completed = useRef(false);
  const generation = useRef(0);
  const order = orders.find(item => item.orderId === draft.orderId);
  const active = cases.find(item => item.active && item.returnId && item.orderId === draft.orderId);
  const selected = order?.items.filter(item => (draft.items[item.variantId] ?? 0) > 0) ?? [];
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true); setError(null); completed.current = false;
    void Promise.all([eligibleReturnOrders(merchantId), returnDraftApi.get(merchantId).catch(() => ({ data: null }))]).then(([data, stored]) => {
      if (current !== generation.current) return;
      setOrders(data.items);
      const value = stored.data;
      if (value && typeof value.orderId === "string" && typeof value.notes === "string" && typeof value.reason === "string" && ["refund", "exchange"].includes(value.kind) && Number.isInteger(value.step) && value.step >= 0 && value.step <= 6 && value.items && typeof value.items === "object" && typeof value.requestKey === "string" && (!initialOrderId || initialOrderId === value.orderId)) {
        const found = data.items.find(item => item.orderId === value.orderId);
        const validItems: Record<string, number> = {};
        found?.items.forEach(item => { const quantity = value.items[item.variantId]; if (Number.isInteger(quantity) && quantity > 0 && quantity <= item.eligibleQuantity) validItems[item.variantId] = quantity; });
        setDraft({ ...value, items: validItems, step: found ? value.step : 0 });
      } else setDraft({ orderId: initialOrderId ?? "", step: data.items.some(item => item.orderId === initialOrderId) ? 1 : 0, kind: "refund", reason: "", notes: "", requestKey: crypto.randomUUID(), items: {} });
    }).catch(e => { if (current === generation.current) setError(e instanceof Error ? e.message : "Não foi possível consultar seus pedidos."); }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [merchantId, initialOrderId]);
  useEffect(() => {
    if (loading || completed.current || !draft.requestKey || !draft.orderId) return;
    setSaved(false);
    const timer = window.setTimeout(() => { void returnDraftApi.save(merchantId, draft).then(() => { if (!completed.current) setSaved(true); }).catch(() => setSaved(false)); }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, loading, merchantId]);
  function edit(values: Partial<ReturnDraft>) { setError(null); setDraft(previous => ({ ...previous, ...values })); }
  function next() {
    if (!order) { setError("Selecione um pedido da lista."); return; }
    if (draft.step === 2 && !selected.length) { setError("Escolha ao menos um item e sua quantidade."); return; }
    if (draft.step === 3 && !draft.reason) { setError("Escolha o motivo da solicitação."); return; }
    if (draft.step === 4 && !draft.notes.trim()) { setError("Conte o que aconteceu para a loja poder analisar."); return; }
    edit({ step: Math.min(6, draft.step + 1) });
  }
  async function submit() {
    if (sending || !order || !selected.length) return;
    setSending(true); setError(null);
    try {
      const result = await openReturnCase({ merchantId, orderId: order.orderId, kind: draft.kind, reason: draft.reason, notes: draft.notes.trim(), requestKey: draft.requestKey, items: selected.map(item => ({ variantId: item.variantId, quantity: draft.items[item.variantId] })), images });
      completed.current = true;
      await returnDraftApi.clear(merchantId).catch(() => undefined);
      supportChanged(); onSuccess(result.ticketId);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível enviar. Seus dados continuam aqui para tentar novamente."); }
    finally { setSending(false); }
  }
  if (loading) return <p className={styles.muted} role="status">Consultando seus pedidos e o rascunho…</p>;
  if (!orders.length) return <div className={styles.stack}><p className={styles.question}>{error ? "Não foi possível consultar seus pedidos" : "Nenhum pedido encontrado nesta loja"}</p><p className={error ? styles.error : styles.muted} role={error ? "alert" : undefined}>{error ?? "Entre com a conta usada na compra. Seus pedidos pagos aparecerão aqui para escolher os itens."}</p><button className={styles.button} onClick={onCancel}>Voltar ao atendimento</button></div>;
  return <div className={styles.stack}>
    <span className={styles.muted}>Troca ou devolução · etapa {draft.step + 1} de 7</span>
    {draft.step > 0 && order && <div className={`${styles.bubble} ${styles.answer}`}>Pedido {order.orderId}<span className={styles.time}>{money(order.totalCents, order.currency)} · {order.completedAt ? new Date(order.completedAt).toLocaleDateString("pt-BR") : "Data não informada"}</span></div>}
    {active ? <><p className={styles.question}>Este pedido já tem uma solicitação em andamento.</p><p className={styles.muted}>Continue na conversa existente. Uma nova solicitação ficará disponível após a resolução.</p><button className={`${styles.button} ${styles.primary}`} onClick={() => onSuccess(active.ticketId)}>Acompanhar conversa</button><button className={styles.button} onClick={() => edit({ step: 0, orderId: "", items: {} })}>Escolher outro pedido</button></> : <>
    {draft.step === 0 && <><h3 className={styles.question}>Sobre qual pedido vamos conversar?</h3>{orders.map(item => <button className={styles.choice} key={item.orderId} disabled={!item.items.some(line => line.eligibleQuantity > 0) && !cases.some(value => value.orderId === item.orderId && value.active)} onClick={() => { setImages([]); edit({ orderId: item.orderId, step: 1, items: {}, requestKey: crypto.randomUUID() }); }}><strong>Pedido {item.orderId}</strong><span className={styles.muted}>{item.items.map(line => `${line.quantity} × ${line.name}`).join(" · ")}</span><span>{money(item.totalCents, item.currency)}{!item.items.some(line => line.eligibleQuantity > 0) ? " · Itens já resolvidos" : ""}</span></button>)}</>}
    {draft.step > 1 && <div className={`${styles.bubble} ${styles.answer}`}>{draft.kind === "refund" ? "Quero devolver e pedir reembolso." : "Quero trocar itens."}</div>}
    {draft.step === 1 && <><h3 className={styles.question}>Você quer trocar ou devolver?</h3><button className={styles.choice} data-selected={draft.kind === "refund"} onClick={() => edit({ kind: "refund", step: 2 })}><strong>Devolver e pedir reembolso</strong><span className={styles.muted}>A loja analisa os itens e informa os próximos passos.</span></button><button className={styles.choice} data-selected={draft.kind === "exchange"} onClick={() => edit({ kind: "exchange", step: 2 })}><strong>Trocar itens</strong><span className={styles.muted}>Conte quais itens precisam ser trocados.</span></button></>}
    {draft.step > 2 && <div className={`${styles.bubble} ${styles.answer}`}>{selected.map(item => `${draft.items[item.variantId]} × ${item.name}`).join("\n")}</div>}
    {draft.step === 2 && <><h3 className={styles.question}>Quais itens e quantidades?</h3><p className={styles.muted}>Escolha apenas os itens envolvidos nesta solicitação.</p>{order?.items.map(item => <div className={styles.item} key={item.variantId}><input id={`return-item-${item.variantId}`} type="checkbox" checked={(draft.items[item.variantId] ?? 0) > 0} disabled={item.eligibleQuantity < 1} onChange={event => edit({ items: { ...draft.items, [item.variantId]: event.target.checked ? 1 : 0 } })} /><label htmlFor={`return-item-${item.variantId}`}><strong>{item.name}</strong><span className={styles.label}>{money(item.unitPriceCents, order.currency)} · {item.eligibleQuantity} disponível(is)</span></label>{(draft.items[item.variantId] ?? 0) > 0 && <input className={`${styles.input} ${styles.quantity}`} type="number" min={1} max={item.eligibleQuantity} aria-label={`Quantidade de ${item.name}`} value={draft.items[item.variantId]} onChange={event => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= item.eligibleQuantity) edit({ items: { ...draft.items, [item.variantId]: quantity } }); }} />}</div>)}</>}
    {draft.step > 3 && <div className={`${styles.bubble} ${styles.answer}`}>{reasons.find(reason => reason.value === draft.reason)?.label}</div>}
    {draft.step === 3 && <><h3 className={styles.question}>O que motivou a solicitação?</h3>{reasons.map(reason => <button className={styles.choice} key={reason.value} data-selected={draft.reason === reason.value} onClick={() => edit({ reason: reason.value, step: 4 })}>{reason.label}</button>)}</>}
    {draft.step === 4 && <><h3 className={styles.question}>Me conte o que aconteceu.</h3><label className={styles.label} htmlFor="return-notes">Sua descrição será enviada à loja.</label><textarea id="return-notes" className={styles.textarea} rows={5} maxLength={3500} placeholder="O que aconteceu com os itens? O que você espera da troca ou devolução?" value={draft.notes} onChange={event => edit({ notes: event.target.value })} /></>}
    {draft.step > 4 && <div className={`${styles.bubble} ${styles.answer}`}>{draft.notes}</div>}
    {draft.step === 5 && <><h3 className={styles.question}>Quer mostrar alguma foto?</h3><p className={styles.muted}>Você pode incluir fotos dos itens, da embalagem ou do problema. Esta etapa é opcional. As fotos só serão enviadas ao confirmar.</p><SupportPhotoPicker images={images} onChange={setImages} /></>}
    {draft.step === 6 && <><h3 className={styles.question}>Está tudo certo para enviar à loja?</h3><dl className={styles.review}><dt>Solicitação</dt><dd>{draft.kind === "refund" ? "Devolução com reembolso" : "Troca"}</dd><dt>Itens</dt><dd>{selected.map(item => <div key={item.variantId}>{draft.items[item.variantId]} × {item.name}</div>)}</dd><dt>Motivo</dt><dd>{reasons.find(reason => reason.value === draft.reason)?.label}</dd><dt>Fotos</dt><dd>{images.length ? `${images.length} anexada(s)` : "Nenhuma foto"}</dd></dl><p className={styles.muted}>A loja receberá os dados do pedido, os itens escolhidos e sua descrição nesta conversa. O reembolso depende da análise e da confirmação do pagamento.</p>{images.length > 0 && <SupportPhotoPicker images={images} onChange={setImages} disabled={sending} />}<button className={`${styles.button} ${styles.primary}`} disabled={sending} onClick={() => void submit()}>{sending ? "Enviando solicitação…" : "Enviar solicitação à loja"}</button></>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.row}>{draft.step > 0 && <button className={styles.button} disabled={sending} onClick={() => edit({ step: draft.step - 1 })}>Voltar</button>}{[2, 4, 5].includes(draft.step) && <button className={`${styles.button} ${styles.primary}`} onClick={next}> {draft.step === 5 && !images.length ? "Continuar sem fotos" : "Continuar"}</button>}</div>
    <p className={styles.muted}>{saved ? "Rascunho salvo na sua conta. As fotos precisam ser anexadas novamente se você sair." : "A solicitação será enviada apenas após sua confirmação."}</p>
    </>}
  </div>;
}
