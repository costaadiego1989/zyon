"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_AGENT_APPEARANCE, type ShoppingAgentAppearance } from "@zyon/shared-types";
import { useModalFocus } from "@zyon/checkout-ui";
import { getValidBuyer } from "@/lib/buyer-auth";
import { API_BASE } from "@/lib/services/http";
import { shoppingAgent, type ShoppingAgentView, type AgentTask, type AgentProduct, type AgentSuggestion, type ShoppingConfig, type ShoppingKind } from "@/lib/services/shopping-agent.service";
import styles from "./AgentTab.module.css";
import { AgentAvatar, AgentIcon } from "./AgentAvatar";
import AgentAppearanceStudio from "./AgentAppearanceStudio";

const InlineCheckout = lazy(() => import("@zyon/widget-v2").then(module => ({ default: module.InlineCheckout })));
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const kindLabels: Record<ShoppingKind, string> = { price_watch: "Acompanhar preço", restock: "Avisar reposição", reorder: "Programar recompra", negotiate: "Buscar condições melhores", basket_budget: "Acompanhar cesta com orçamento" };
const statusLabels: Record<string, string> = { active: "Ativa", paused: "Pausada", cancelled: "Encerrada", expired: "Validade encerrada" };
const outcomeLabels: Record<string, string> = { opportunity: "Condição encontrada", monitoring: "Acompanhando condições", unavailable: "Aguardando disponibilidade", over_budget: "Acima do limite", premium_required: "Recurso premium inativo", agent_shipping_unavailable: "Entrega indisponível", agent_product_unavailable: "Revise a disponibilidade dos itens", temporarily_unavailable: "A consulta será repetida" };
function cents(value: string) {
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) throw new Error("Informe um valor em reais, como 150,00.");
  return Math.round(Number(value.replace(",", ".")) * 100);
}
interface Editor { kind: ShoppingKind; title: string; items: ShoppingConfig["items"]; target: string; shipping: boolean; zip: string; interval: string; discount: string; expiry: string; deadline: string }
const emptyEditor = (): Editor => ({ kind: "price_watch", title: "", items: [], target: "", shipping: false, zip: "", interval: "30", discount: "5", expiry: "", deadline: "" });

function AgentCheckout({ token, cartRef, merchantId, theme, onClose }: { token: string; cartRef: string; merchantId: string; theme?: "light" | "dark"; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref, onClose);
  return createPortal(<div ref={ref} className={styles.checkout} role="dialog" aria-modal="true" aria-label="Revisar compra do agente" tabIndex={-1}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className={styles.checkoutHeader}><strong>Revisar compra do agente</strong><button data-neu="control" type="button" onClick={onClose}>Voltar ao agente</button></div>
    <div className={styles.checkoutBody}><Suspense fallback={<p role="status">Carregando seu checkout…</p>}><InlineCheckout embedToken={token} cartRef={cartRef} merchantId={merchantId} apiBaseUrl={API_BASE} embedApiBaseUrl={API_BASE.startsWith("/") ? "/api" : API_BASE}
      buyerAccessToken={getValidBuyer()?.token} initialChannel="chat" theme={theme} onClose={onClose} /></Suspense></div>
  </div>, document.body);
}

export default function AgentTab({ merchantId, storeName, theme }: { merchantId: string; storeName?: string; theme?: "light" | "dark" }) {
  const [view, setView] = useState<ShoppingAgentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Meu agente");
  const [accepted, setAccepted] = useState(false);
  const [email, setEmail] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [quietStart, setQuietStart] = useState("22");
  const [quietEnd, setQuietEnd] = useState("8");
  const [dailyLimit, setDailyLimit] = useState("3");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editing, setEditing] = useState<AgentTask | null>(null);
  const [products, setProducts] = useState<AgentProduct[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [checkout, setCheckout] = useState<{ embedToken: string; cartRef: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [appearance, setAppearance] = useState<ShoppingAgentAppearance>({ ...DEFAULT_AGENT_APPEARANCE });
  const customizeRef = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const requestKey = useRef<string | null>(null);
  const load = useCallback(async (settings = false) => {
    const version = generation.current;
    const result = await shoppingAgent.get(merchantId);
    if (generation.current !== version) return;
    setView(result);
    if (settings) {
      setName(result.profile?.name ?? "Meu agente"); setEmail(result.state?.settings.email ?? false); setWhatsapp(result.state?.settings.whatsapp ?? false);
      setQuietStart(String(result.state?.settings.quietStart ?? 22)); setQuietEnd(String(result.state?.settings.quietEnd ?? 8)); setDailyLimit(String(result.state?.settings.maxDailyNotifications ?? 3));
      setAppearance(result.state?.settings.appearance ?? { ...DEFAULT_AGENT_APPEARANCE });
    }
  }, [merchantId]);
  useEffect(() => {
    generation.current++; const version = generation.current;
    setLoading(true); setError(null); setView(null); setCheckout(null); setEditor(null); setSuggestions([]); setShowStudio(false);
    void load(true).catch(e => { if (generation.current === version) setError(e.message); }).finally(() => { if (generation.current === version) setLoading(false); });
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => {}); }, 15_000);
    return () => { generation.current++; clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    if (!view?.premium || !view.state) return;
    let active = true;
    void shoppingAgent.suggestions(merchantId).then(result => { if (active) setSuggestions(result.items); }).catch(() => {});
    return () => { active = false; };
  }, [merchantId, view?.premium, Boolean(view?.state)]);
  useEffect(() => {
    if (!editor || !view?.premium) return;
    let active = true; setSearching(true);
    const timer = setTimeout(() => { void shoppingAgent.catalog(merchantId, query).then(result => { if (active) setProducts(result.items); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setSearching(false); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [merchantId, query, Boolean(editor), view?.premium]);
  const run = async (operation: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    const version = generation.current;
    setBusy(true); setError(null); setNotice(null);
    try { await operation(); if (version === generation.current) { await load(); if (message) setNotice(message); } }
    catch (e) { if (version === generation.current) { setError(e instanceof Error ? e.message : "Não foi possível concluir a ação."); await load().catch(() => {}); } }
    finally { if (version === generation.current) setBusy(false); }
  };
  const setField = <K extends keyof Editor>(key: K, value: Editor[K]) => { requestKey.current = null; setEditor(current => current ? { ...current, [key]: value } : null); };
  const addItem = (productId: string, variantId: string, quantity = 1) => {
    requestKey.current = null;
    setEditor(current => current && !current.items.some(i => i.variantId === variantId) ? { ...current, items: [...current.items, { productId, variantId, quantity }] } : current);
  };
  const saveTask = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!editor) return;
      const config: ShoppingConfig = { kind: editor.kind, title: editor.title, items: editor.items, includeShipping: editor.shipping,
        targetDiscountPercent: editor.kind === "negotiate" ? Number(editor.discount) : 0,
        ...(editor.target ? { targetCents: cents(editor.target) } : {}),
        ...(editor.shipping ? { destinationZip: editor.zip } : {}),
        ...(editor.kind === "reorder" ? { intervalDays: Number(editor.interval) } : {}),
        ...(editor.expiry ? { expiresAt: new Date(`${editor.expiry}T23:59:59`).toISOString() } : {}),
        ...(editor.shipping && editor.deadline ? { maxDeliveryDays: Number(editor.deadline) } : {}) };
      if (editing) await shoppingAgent.change(merchantId, editing, "update", config);
      else { requestKey.current ??= crypto.randomUUID(); await shoppingAgent.create(merchantId, config, requestKey.current); }
      setEditor(null); setEditing(null); requestKey.current = null;
    }, editing ? "Tarefa atualizada." : "Tarefa criada. O agente fará a primeira consulta no servidor.");
  };
  const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: view?.state?.settings.timeZone ?? "America/Sao_Paulo" }).format(new Date(value));
  const editTask = (task: AgentTask) => {
    requestKey.current = null; setEditing(task);
    setEditor({ kind: task.config.kind, title: task.config.title, items: task.config.items, target: task.config.targetCents ? (task.config.targetCents / 100).toFixed(2).replace(".", ",") : "",
      shipping: task.config.includeShipping, zip: task.config.destinationZip ?? "", interval: String(task.config.intervalDays ?? 30), discount: String(task.config.targetDiscountPercent),
      expiry: task.config.expiresAt?.slice(0, 10) ?? "", deadline: task.config.maxDeliveryDays ? String(task.config.maxDeliveryDays) : "" });
  };
  if (loading) return <div className={styles.agent} role="status" aria-label="Carregando meu agente"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div>;
  if (!view) return <div className={styles.agent}><p role="alert">{error}</p><button type="button" onClick={() => void run(() => load(true))}>Tentar novamente</button></div>;
  const state = view.state;
  const displayName = state ? view.profile?.name ?? name : name;
  const displayAppearance = state?.settings.appearance ?? appearance;
  const closeStudio = () => { setShowStudio(false); requestAnimationFrame(() => customizeRef.current?.focus({ preventScroll: true })); };
  if (showStudio) return <AgentAppearanceStudio name={displayName} appearance={displayAppearance} creating={!state} onCancel={closeStudio}
    onSave={async (newName, newAppearance) => {
      if (state) { await shoppingAgent.configure(merchantId, { name: newName, appearance: newAppearance }); await load(true); }
      else { setName(newName); setAppearance(newAppearance); }
      closeStudio(); if (state) setNotice("Seu agente está de cara nova. Visual salvo.");
    }} />;
  return <div className={styles.agent}>
    <header className={styles.intro}>
      <div className={styles.identity}><button type="button" className={styles.portraitButton} onClick={() => setShowStudio(true)} aria-label="Personalizar avatar" disabled={!view.premium || busy}>
        <AgentAvatar name={displayName} appearance={displayAppearance} size={96} /><span className={styles.portraitEdit}><AgentIcon name="edit" size={12} /></span></button>
        <div className={styles.identityText}><span className={styles.identityLabel}>Seu agente pessoal</span><h2>{displayName}</h2>
          <span className={styles.presence} data-active={state?.settings.enabled ?? false}><i aria-hidden="true" />{state ? state.settings.enabled ? "Cuidando das suas próximas compras" : "Em pausa, no seu tempo" : "Pronto para começar com você"}</span></div>
      </div>
      <p className={styles.introCopy}>De olho no que você quer. No momento que faz sentido para você.</p>
      <div className={styles.identityTools}><button ref={customizeRef} type="button" onClick={() => setShowStudio(true)} disabled={!view.premium || busy}><AgentIcon name="edit" size={15} />Personalizar agente</button>
        {state && <button type="button" onClick={() => setShowSettings(value => !value)} aria-expanded={showSettings}><AgentIcon name="settings" size={16} />Preferências</button>}</div>
      <div className={styles.storeScope}><span>{storeName ?? "Esta loja"}</span><span>Você decide cada compra</span></div>
    </header>
    {(error || notice) && <div aria-live="polite">{error && <p className={styles.error} role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</div>}
    {!view.premium && <p className={styles.error}>Esta loja precisa habilitar o recurso premium para novas tarefas. Seu histórico e os controles para pausar ou encerrar continuam disponíveis.</p>}
    {(!state || showSettings) && <form className={styles.form} onSubmit={event => { event.preventDefault(); void run(async () => {
      await shoppingAgent.configure(merchantId, { name, ...(!state ? { appearance } : {}), accepted, email, whatsapp, quietStart: Number(quietStart), quietEnd: Number(quietEnd), maxDailyNotifications: Number(dailyLimit), enabled: state?.settings.enabled ?? true }); setShowSettings(false);
    }, "Preferências salvas."); }}>
      <label>Nome do agente<input data-neu="field" maxLength={60} required value={name} onChange={e => setName(e.target.value)} /></label>
      <p className={styles.help}>As tarefas acompanham somente esta loja. Cada proposta será revisada por você antes do pagamento.</p>
      {!state && <label className={styles.check}><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required />Quero criar meu agente e salvar minhas tarefas nesta loja.</label>}
      <label className={styles.check}><input type="checkbox" checked={email} onChange={e => setEmail(e.target.checked)} disabled={!view.premium && !state?.settings.email} />Receber por e-mail avisos das minhas tarefas.</label>
      <label className={styles.check}><input type="checkbox" checked={whatsapp} onChange={e => setWhatsapp(e.target.checked)} disabled={!view.premium && !state?.settings.whatsapp} />Receber pelo WhatsApp avisos das minhas tarefas.</label>
      {whatsapp && <p className={styles.help}>O envio depende do WhatsApp conectado à loja e do modelo de mensagem aprovado. O resultado sempre fica disponível aqui.</p>}
      <div className={styles.row}><label>Silêncio a partir de<input type="number" min="0" max="23" value={quietStart} onChange={e => setQuietStart(e.target.value)} /></label>
        <label>Voltar a avisar às<input type="number" min="0" max="23" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} /></label>
        <label>Máximo de avisos por dia<input type="number" min="1" max="20" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} /></label></div>
      <p className={styles.help}>Horários em {state?.settings.timeZone ?? "America/Sao_Paulo"}. Esses avisos não ativam campanhas promocionais.</p>
      <button data-neu="primary" className={styles.primary} type="submit" disabled={busy || !state && (!view.premium || !accepted)}>{busy ? "Salvando…" : state ? "Salvar preferências" : "Criar meu agente"}</button>
    </form>}
    {state && <>
      <div className={styles.toolbar}><div><strong>Compras no seu ritmo</strong><p>{state.tasks.filter(task => task.status === "active").length} {state.tasks.filter(task => task.status === "active").length === 1 ? "tarefa ativa" : "tarefas ativas"}</p></div>
        <button className={styles.primary} data-neu="primary" type="button" disabled={busy || !view.premium || !state.settings.enabled} onClick={() => { setEditing(null); setEditor(emptyEditor()); requestKey.current = null; }}><AgentIcon name="plus" size={16} />Nova tarefa</button></div>
      {!state.settings.enabled && <p>Seu agente está pausado. As tarefas e o histórico foram preservados.</p>}
      {editor && <form className={styles.form} onSubmit={saveTask}>
        <h3>{editing ? "Editar tarefa" : "Nova tarefa"}</h3>
        <label>O que o agente deve fazer?<select data-neu="field" value={editor.kind} onChange={e => setField("kind", e.target.value as ShoppingKind)}>{Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
        <label>Nome da tarefa<input data-neu="field" required maxLength={120} placeholder="Ex.: acompanhar meu café" value={editor.title} onChange={e => setField("title", e.target.value)} /></label>
        <label>Buscar produtos<input data-neu="field" value={query} maxLength={120} placeholder="Nome do produto" onChange={e => setQuery(e.target.value)} /></label>
        {searching && <p role="status">Consultando o catálogo…</p>}
        {!searching && !products.length && <p>Nenhum produto encontrado. Tente outro nome.</p>}
        <ul className={styles.list}>{products.map(product => <li key={product.id}><strong>{product.name}</strong><div className={styles.actions}>{product.variants.map(variant => <button key={variant.id} type="button" disabled={editor.items.some(i => i.variantId === variant.id) || editor.items.length >= 20} onClick={() => addItem(product.id, variant.id)}>{variant.label} · {money(variant.priceCents)}{!variant.available ? " · sem estoque" : ""}</button>)}</div></li>)}</ul>
        {editor.items.length > 0 && <><h3>Itens da tarefa</h3><ul className={styles.list}>{editor.items.map((item, index) => {
          const product = products.find(p => p.id === item.productId); const prior = state.activities.flatMap(a => a.quote?.items ?? []).find(i => i.variantId === item.variantId);
          return <li key={item.variantId}><strong>{product?.name ?? prior?.name ?? `Produto selecionado ${index + 1}`}</strong><div className={styles.row}><label>Quantidade<input type="number" min="1" max="100" required value={item.quantity} onChange={e => setField("items", editor.items.map(i => i.variantId === item.variantId ? { ...i, quantity: Number(e.target.value) } : i))} /></label><button type="button" onClick={() => setField("items", editor.items.filter(i => i.variantId !== item.variantId))}>Remover</button></div></li>;
        })}</ul></>}
        <div className={styles.row}>{editor.kind !== "restock" && <label>{editor.kind === "price_watch" || editor.kind === "basket_budget" ? "Avise até este total (R$)" : "Limite de total opcional (R$)"}<input data-neu="field" inputMode="decimal" required={["price_watch", "basket_budget"].includes(editor.kind)} value={editor.target} placeholder="Ex.: 150,00" onChange={e => setField("target", e.target.value)} /></label>}
          {editor.kind === "reorder" && <label>Repetir a cada quantos dias?<input type="number" min="1" max="365" required value={editor.interval} onChange={e => setField("interval", e.target.value)} /></label>}
          {editor.kind === "negotiate" && <label>Desconto mínimo (%)<input type="number" min="0" max="50" required value={editor.discount} onChange={e => setField("discount", e.target.value)} /></label>}</div>
        {editor.kind === "reorder" && <p className={styles.help}>A primeira proposta será preparada após esse intervalo. Você poderá pular qualquer ciclo.</p>}
        <label className={styles.check}><input type="checkbox" checked={editor.shipping} onChange={e => setField("shipping", e.target.checked)} />Incluir frete no limite.</label>
        {editor.shipping && <div className={styles.row}><label>CEP de entrega<input required inputMode="numeric" maxLength={9} placeholder="00000-000" value={editor.zip} onChange={e => setField("zip", e.target.value)} /></label><label>Prazo máximo opcional (dias)<input type="number" min="1" max="365" value={editor.deadline} onChange={e => setField("deadline", e.target.value)} /></label></div>}
        <p className={styles.help}>O total considera os itens e a taxa de serviço{editor.shipping ? ", com frete cotado para o CEP escolhido." : ". O frete será calculado à parte no checkout."}</p>
        <label>Acompanhar até (opcional)<input type="date" value={editor.expiry} onChange={e => setField("expiry", e.target.value)} /></label>
        <div className={styles.actions}><button className={styles.primary} data-neu="primary" type="submit" disabled={busy || !editor.items.length}>{busy ? "Salvando…" : "Salvar tarefa"}</button><button type="button" disabled={busy} onClick={() => { setEditor(null); setEditing(null); }}>Cancelar edição</button></div>
      </form>}
      <section aria-label="Tarefas"><h3 className={styles.sectionHeading}>Minhas tarefas<span>{state.tasks.length}</span></h3>{!state.tasks.length ? <div className={styles.empty}><AgentIcon name="price_watch" size={26} /><strong>Deixe a próxima boa compra com seu agente.</strong><p>Escolha um produto para acompanhar ou programe uma compra que você costuma repetir.</p></div> : <ul className={`${styles.list} ${styles.taskList}`}>{state.tasks.map(task => <li key={task.id}>
        <div className={styles.taskTop}><span className={styles.taskIcon}><AgentIcon name={task.config.kind} size={20} /></span><div className={styles.taskInfo}><strong>{task.config.title}</strong><p>{kindLabels[task.config.kind]}{task.config.intervalDays ? ` · ${task.config.intervalDays} dias` : ""}</p></div><span className={styles.badge} data-status={task.status}>{statusLabels[task.status] ?? task.status}</span></div>
        {task.config.targetCents && <p className={styles.help}>Limite total: {money(task.config.targetCents)}</p>}
        {task.status === "active" && <p className={styles.schedule}><AgentIcon name="clock" size={14} />Próxima consulta: {date(task.nextRunAt)}</p>}
        {task.lastRunAt && <p className={styles.help}>Última consulta: {date(task.lastRunAt)} · {outcomeLabels[task.lastOutcome ?? ""] ?? "O agente tentará consultar novamente"}</p>}
        {task.status !== "cancelled" && <div className={`${styles.actions} ${styles.taskActions}`}>
          <button type="button" disabled={busy || !view.premium || !state.settings.enabled} onClick={() => editTask(task)}>Editar</button>
          {task.status !== "expired" && <button type="button" disabled={busy || task.status === "paused" && (!view.premium || !state.settings.enabled)} onClick={() => void run(() => shoppingAgent.change(merchantId, task, task.status === "active" ? "pause" : "resume"))}>{task.status === "active" ? "Pausar" : "Retomar"}</button>}
          {task.status === "active" && <button type="button" disabled={busy || !view.premium || !state.settings.enabled} onClick={() => void run(() => shoppingAgent.change(merchantId, task, "check"), "Consulta agendada. O resultado aparecerá aqui.")}>Verificar agora</button>}
          {task.status === "active" && task.config.kind === "reorder" && <button type="button" disabled={busy} onClick={() => void run(() => shoppingAgent.change(merchantId, task, "skip"), "Este ciclo foi pulado.")}>Pular ciclo</button>}
          <button type="button" disabled={busy} onClick={() => void run(() => shoppingAgent.change(merchantId, task, "cancel"), "Tarefa encerrada.")}>Encerrar</button>
        </div>}
      </li>)}</ul>}</section>
      {!editor && suggestions.length > 0 && view.premium && state.settings.enabled && <section aria-label="Sugestões de recompra"><h3>Compras que você pode programar</h3><p className={styles.help}>Sugestões do seu histórico nesta loja. Uma programação só começa quando você salvar a tarefa.</p><ul className={styles.list}>{suggestions.map(suggestion => <li key={suggestion.variantId}><div className={styles.line}><strong>{suggestion.name}</strong><button type="button" onClick={() => { setEditing(null); setEditor({ ...emptyEditor(), kind: "reorder", title: `Recompra de ${suggestion.name}`.slice(0, 120), items: [{ productId: suggestion.productId, variantId: suggestion.variantId, quantity: suggestion.quantity }], interval: String(suggestion.intervalDays) }); }}>Programar</button></div><p className={styles.help}>{suggestion.basedOnPurchases > 1 ? `Intervalo sugerido: ${suggestion.intervalDays} dias, com base em ${suggestion.basedOnPurchases} compras.` : "Escolha uma frequência para sua próxima compra."}</p></li>)}</ul></section>}
      <section aria-label="Atividades do agente"><h3 className={styles.sectionHeading}>Atividades e propostas<span>{state.activities.length}</span></h3>{!state.activities.length ? <p className={styles.help}>Quando uma condição for encontrada ou uma recompra chegar à data, o resultado aparecerá aqui.</p> : <ul className={`${styles.list} ${styles.activityList}`}>{state.activities.map(activity => <li key={activity.id}>
        <div className={styles.activityMeta}><span>{activity.kind === "opportunity" && activity.decision === "pending" ? "Pronta para sua revisão" : activity.decision === "checkout" ? "Checkout aberto" : "Atualização do agente"}</span><time dateTime={activity.createdAt}>{date(activity.createdAt)}</time></div>
        <p className={styles.activityMessage}>{activity.message}</p>
        {activity.quote && <div className={styles.ledger}>{activity.quote.items.map(item => <div className={styles.line} key={item.variantId}><span>{item.quantity} × {item.name}</span><span>{money(item.quantity * item.unitPriceCents)}</span></div>)}
          {activity.quote.discountCents > 0 && <div className={styles.line}><span>Desconto autorizado</span><span>− {money(activity.quote.discountCents)}</span></div>}
          <div className={styles.line}><span>Taxa de serviço</span><span>{money(activity.quote.serviceFeeCents)}</span></div>
          <div className={styles.line}><span>Frete{activity.quote.shippingLabel ? ` · ${activity.quote.shippingLabel}` : ""}</span><span>{activity.quote.shippingCents === null ? "A calcular" : money(activity.quote.shippingCents)}</span></div>
          <div className={`${styles.line} ${styles.total}`}><span>{activity.quote.shippingCents === null ? "Total sem frete" : "Total cotado"}</span><span>{money(activity.quote.totalCents)}</span></div>
        </div>}
        {activity.kind === "opportunity" && ["pending", "checkout"].includes(activity.decision) && <>
          <p className={styles.help}>Condições consultadas até {activity.quote ? date(activity.quote.expiresAt) : "esta consulta"}. Ao revisar, verificaremos novamente. Esta compra será aberta separadamente do seu carrinho atual.</p>
          <div className={styles.actions}><button className={styles.primary} data-neu="primary" type="button" disabled={busy || !view.premium || !state.settings.enabled} onClick={() => void run(async () => { const result = await shoppingAgent.decide(merchantId, activity.id, "checkout"); if (result.embedToken && result.cartRef) setCheckout({ embedToken: result.embedToken, cartRef: result.cartRef }); })}>{busy ? "Verificando…" : "Revisar e ir ao checkout"}</button>
            <button type="button" disabled={busy} onClick={() => void run(() => shoppingAgent.decide(merchantId, activity.id, "dismiss"))}>Dispensar proposta</button></div>
        </>}
        {activity.decision === "expired" && <p className={styles.help}>As condições mudaram. Use Verificar agora na tarefa para preparar uma nova proposta.</p>}
        {Object.entries(activity.deliveries).map(([channel, delivery]) => <p key={channel} className={styles.help}>{channel === "email" ? "E-mail" : "WhatsApp"}: {({ pending: "aviso aguardando envio", sending: "confirmando envio", sent: "aceito pelo provedor", skipped: "aviso indisponível neste canal", uncertain: "envio sem confirmação; consulte o resultado aqui" } as Record<string, string>)[delivery?.status ?? ""]}</p>)}
      </li>)}</ul>}</section>
      <footer className={styles.agentFooter}><span>Seu agente, suas escolhas.</span><button type="button" disabled={busy || !view.premium && !state.settings.enabled} onClick={() => void run(() => shoppingAgent.configure(merchantId, { enabled: !state.settings.enabled }), state.settings.enabled ? "Agente pausado. Novas consultas e avisos foram interrompidos." : "Agente ativado.")}>{state.settings.enabled ? "Pausar agente" : "Ativar agente"}</button></footer>
    </>}
    {checkout && <AgentCheckout token={checkout.embedToken} cartRef={checkout.cartRef} merchantId={merchantId} theme={theme} onClose={() => setCheckout(null)} />}
  </div>;
}
