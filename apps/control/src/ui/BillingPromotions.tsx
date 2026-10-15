import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Plus, RefreshCw, Search, TicketPercent } from "lucide-react";
import { PlatformApi, PlatformApiError } from "../lib/api.js";
import type { BillingPromotion, BillingPromotionDraft, BillingPromotionsPage, BillingPromotionsQuery, PromotionPlan } from "../lib/billing-promotions.js";
import "./BillingPromotions.css";

type Form = {
  name: string; code: string; discountType: "percent" | "fixed"; value: string;
  duration: "once" | "repeating" | "forever"; months: string; plans: PromotionPlan[];
  startsAt: string; expiresAt: string; maxUses: string; firstTimeOnly: boolean;
};
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const localDateTime = (date: Date) => new Date(date.getTime() - 3 * 3600000).toISOString().slice(0, 16);
const freshForm = (): Form => ({ name: "", code: "", discountType: "percent", value: "", duration: "once", months: "", plans: ["starter179", "growth", "scale"], startsAt: localDateTime(new Date()), expiresAt: "", maxUses: "", firstTimeOnly: false });
const initialFilters = { search: "", status: "", discountType: "", plan: "" };
const statuses: Record<string, string> = { active: "Habilitado", paused: "Desabilitado", scheduled: "Agendado", expired: "Expirado", exhausted: "Esgotado", pending: "Pendente", unverified: "Não verificado", sync_pending: "Sincronizando" };

export function BillingPromotions({ api, token, canWrite, onSessionExpired }: { api: PlatformApi; token: string; canWrite: boolean; onSessionExpired: () => void }) {
  const [data, setData] = useState<BillingPromotionsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(freshForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [query, setQuery] = useState<BillingPromotionsQuery>({ page: 1, pageSize: 10 });
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const sessionExpired = useRef(onSessionExpired);
  sessionExpired.current = onSessionExpired;

  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void api.listBillingPromotions(token, query).then(page => {
      if (!current) return;
      if (query.page > page.pagination.totalPages) { setQuery(previous => ({ ...previous, page: page.pagination.totalPages })); return; }
      setData(page);
    }).catch(caught => {
      if (!current) return;
      if (caught instanceof PlatformApiError && caught.status === 401) { sessionExpired.current(); return; }
      setError(caught instanceof PlatformApiError ? caught.message : "Não foi possível consultar os cupons. Tente novamente.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, token, query, refresh]);
  useEffect(() => { if (showForm) heading.current?.focus(); }, [showForm]);

  function patch(change: Partial<Form>) {
    setForm(previous => ({ ...previous, ...change })); setFormError(null);
    requestId.current = crypto.randomUUID();
  }
  function open(row?: BillingPromotion) {
    setEditingId(row?.id ?? null); setFormError(null); setMessage(null);
    requestId.current = crypto.randomUUID();
    setForm(row ? { name: row.name, code: row.code, discountType: row.discountType, value: String(row.discountValue / 100),
      duration: row.duration, months: row.durationMonths ? String(row.durationMonths) : "", plans: row.plans,
      startsAt: localDateTime(new Date(row.startsAt)), expiresAt: localDateTime(new Date(row.expiresAt)),
      maxUses: row.maxRedemptions ? String(row.maxRedemptions) : "", firstTimeOnly: row.firstTimeOnly } : freshForm());
    setShowForm(true);
  }

  const preview = (data?.plans ?? []).filter(plan => form.plans.includes(plan.id)).map(plan => {
    const value = Math.round(Number(form.value || 0) * 100);
    const discount = form.discountType === "percent" ? Math.round(plan.monthlyPriceCents * value / 10000) : value;
    return { ...plan, total: plan.monthlyPriceCents - discount };
  });

  async function save(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setFormError(null); setMessage(null);
    if (!form.plans.length) { setFormError("Selecione pelo menos um plano."); return; }
    if (new Date(form.expiresAt + "-03:00") <= new Date(form.startsAt + "-03:00")) { setFormError("A data final deve ser posterior à data de início."); return; }
    if (preview.some(plan => plan.total < 0 || (plan.total > 0 && plan.total < (data?.policy.minChargeCents ?? 50)))) { setFormError(`Revise o desconto. A cobrança precisa ser zero ou de pelo menos ${brl(data?.policy.minChargeCents ?? 50)}.`); return; }
    const payload: BillingPromotionDraft = {
      id: editingId ?? requestId.current, name: form.name.trim() || form.code.trim().toUpperCase(), code: form.code.trim().toUpperCase(), plans: form.plans,
      discountType: form.discountType, discountValue: Math.round(Number(form.value) * 100),
      duration: form.duration, durationMonths: form.duration === "repeating" ? Number(form.months) : null,
      startsAt: new Date(form.startsAt + "-03:00").toISOString(), expiresAt: new Date(form.expiresAt + "-03:00").toISOString(),
      maxRedemptions: form.maxUses ? Number(form.maxUses) : null, firstTimeOnly: form.firstTimeOnly,
    };
    setSaving(true);
    try {
      const saved = editingId ? await api.updateBillingPromotion(token, payload) : await api.createBillingPromotion(token, payload);
      setShowForm(false); setForm(freshForm()); setEditingId(null); setRefresh(n => n + 1);
      setMessage(`Cupom ${saved.code} ${editingId ? "atualizado" : "criado"}.`);
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) { sessionExpired.current(); return; }
      setFormError(caught instanceof PlatformApiError ? caught.message : "Não foi possível salvar o cupom. Seus dados foram mantidos.");
    } finally { setSaving(false); }
  }

  async function mutate(row: BillingPromotion, action: "toggle" | "retry" | "delete") {
    if (busyId) return; setBusyId(row.id); setError(null); setMessage(null);
    try {
      if (action === "delete") {
        await api.deleteBillingPromotion(token, row.id); setDeletingId(null);
        setMessage(`Cupom ${row.code} excluído. Os descontos já concedidos foram preservados.`);
      } else {
        const updated = action === "retry" ? await api.retryBillingPromotion(token, row.id) : await api.toggleBillingPromotion(token, row.id, !row.enabled);
        setMessage(`Cupom ${updated.code}: ${statuses[updated.status] ?? updated.status}.`);
      }
      setRefresh(n => n + 1);
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) { sessionExpired.current(); return; }
      setError(caught instanceof PlatformApiError ? caught.message : "Não foi possível atualizar o cupom. Tente novamente.");
    } finally { setBusyId(null); }
  }
  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(code); setMessage(`Código ${code} copiado.`); }
    catch { setError(`Não foi possível copiar automaticamente. Código: ${code}`); }
  }

  return <div className="page-flow billing-promotions">
    <section className="page-intro">
      <div><h2>Cupons de assinatura</h2><p>Gerencie os descontos usados no pagamento das assinaturas mensais.</p></div>
      {canWrite && !showForm && <button className="button button--primary" disabled={!data} onClick={() => open()}><Plus size={16} />Criar cupom</button>}
    </section>
    {message && <p className="promotion-feedback promotion-feedback--success" role="status"><Check size={17} aria-hidden="true" />{message}</p>}
    {error && <div className="promotion-feedback" role="alert"><span>{error}</span><button className="button button--secondary" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Tentar novamente</button></div>}

    {showForm && canWrite ? <section className="promotion-editor" aria-labelledby="promotion-editor-heading">
      <div className="promotion-editor__heading"><h2 id="promotion-editor-heading" ref={heading} tabIndex={-1}>{editingId ? "Editar cupom" : "Novo cupom"}</h2><button className="button button--secondary" disabled={saving} onClick={() => setShowForm(false)}><ArrowLeft size={15} />Voltar aos cupons</button></div>
      <form className="promotion-form promotion-form--simple" onSubmit={save}>
        <fieldset disabled={saving}>
          <legend className="promotion-sr-only">Dados do cupom</legend>
          <div className="promotion-fields">
            <label><span>Código do cupom</span><input required pattern="[A-Z0-9-]{3,40}" maxLength={40} value={form.code} onChange={e => patch({ code: e.target.value.toUpperCase() })} placeholder="Ex.: BLACKFRIDAY" autoComplete="off" /><small>De 3 a 40 letras, números ou hífens.</small></label>
            <label><span>Nome da campanha (opcional)</span><input minLength={3} maxLength={120} value={form.name} onChange={e => patch({ name: e.target.value })} placeholder="Ex.: Black Friday" autoComplete="off" /></label>
            <label><span>Tipo de desconto</span><select value={form.discountType} onChange={e => patch({ discountType: e.target.value as Form["discountType"] })}><option value="percent">Percentual (%)</option><option value="fixed">Valor em reais (R$)</option></select></label>
            <label><span>{form.discountType === "percent" ? "Valor do desconto (%)" : "Valor do desconto (R$)"}</span><input required type="number" min="0.01" step="0.01" placeholder={form.discountType === "percent" ? "Ex.: 50" : "Ex.: 20,00"} max={form.discountType === "percent" ? 100 : undefined} value={form.value} onChange={e => patch({ value: e.target.value })} /></label>
            <label><span>Data de início</span><input required type="datetime-local" value={form.startsAt} onChange={e => patch({ startsAt: e.target.value })} /></label>
            <label><span>Data final</span><input required type="datetime-local" value={form.expiresAt} onChange={e => patch({ expiresAt: e.target.value })} /></label>
          </div>
          <p className="promotion-help">Horário de Brasília. A data final encerra novos usos do código; os descontos já concedidos seguem a duração definida abaixo.</p>
        </fieldset>
        <details className="promotion-options" open={editingId !== null || form.duration !== "once"}>
          <summary>Opções da assinatura e limites<span>Primeira mensalidade, planos elegíveis e limite de usos</span></summary>
          <fieldset disabled={saving}>
            <legend className="promotion-sr-only">Opções da assinatura</legend>
            <div className="promotion-fields">
              <label><span>Duração do desconto</span><select value={form.duration} onChange={e => patch({ duration: e.target.value as Form["duration"] })}><option value="once">Só na primeira mensalidade</option><option value="repeating">Por um número de meses</option><option value="forever">Enquanto a assinatura existir</option></select></label>
              {form.duration === "repeating" && <label><span>Quantidade de meses</span><input required type="number" min="1" step="1" max={data?.policy.maxMonths ?? 36} value={form.months} onChange={e => patch({ months: e.target.value })} /></label>}
              <label><span>Limite total de usos</span><input type="number" min="1" step="1" value={form.maxUses} onChange={e => patch({ maxUses: e.target.value })} placeholder="Sem limite" /></label>
            </div>
            <p className="promotion-field-title">Planos elegíveis</p><div className="promotion-plans">{data?.plans.map(plan => <label key={plan.id}><input type="checkbox" checked={form.plans.includes(plan.id)} onChange={e => patch({ plans: e.target.checked ? [...form.plans, plan.id] : form.plans.filter(id => id !== plan.id) })} /><span>{plan.name}<small>{brl(plan.monthlyPriceCents)}/mês</small></span></label>)}</div>
            <label className="promotion-checkbox"><input type="checkbox" checked={form.firstTimeOnly} onChange={e => patch({ firstTimeOnly: e.target.checked })} /><span>Apenas clientes sem pagamentos anteriores</span></label>
          </fieldset>
        </details>
        {form.value && <div className="promotion-summary" aria-live="polite"><strong>Com este desconto</strong><span>{preview.map(plan => `${plan.name}: ${brl(Math.max(0, plan.total))}/mês`).join(" · ")}</span><small>{form.duration === "once" ? "Na primeira mensalidade. Depois, valor integral do plano." : form.duration === "repeating" ? `Durante ${form.months || "0"} meses. Depois, valor integral do plano.` : "Em todas as mensalidades da assinatura."} As taxas por compra permanecem iguais.</small></div>}
        {formError && <p className="promotion-feedback" role="alert">{formError}</p>}
        <div className="promotion-form__actions"><p>O código poderá ser informado no pagamento Stripe.</p><div><button type="button" className="button button--secondary" disabled={saving} onClick={() => setShowForm(false)}>Cancelar</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? "Salvando…" : editingId ? "Salvar alterações" : "Criar cupom"}</button></div></div>
      </form>
    </section> : <section className="promotion-register" aria-labelledby="promotion-register-heading">
      <div className="section-heading"><h2 id="promotion-register-heading">Cupons cadastrados</h2><button className="button button--secondary" disabled={loading} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} />Atualizar</button></div>
      <form className="promotion-filters" onSubmit={event => { event.preventDefault(); setQuery({ ...filters, page: 1, pageSize: query.pageSize }); }}>
        <label className="promotion-filters__search"><span>Buscar cupom</span><div><Search size={15} aria-hidden="true" /><input value={filters.search} onChange={e => setFilters(previous => ({ ...previous, search: e.target.value }))} placeholder="Código ou nome" maxLength={120} /></div></label>
        <label><span>Status</span><select value={filters.status} onChange={e => setFilters(previous => ({ ...previous, status: e.target.value }))}><option value="">Todos</option><option value="enabled">Habilitados</option><option value="disabled">Desabilitados</option><option value="scheduled">Agendados</option><option value="expired">Expirados</option><option value="pending">Pendentes</option></select></label>
        <label><span>Tipo</span><select value={filters.discountType} onChange={e => setFilters(previous => ({ ...previous, discountType: e.target.value }))}><option value="">Todos</option><option value="percent">Percentual (%)</option><option value="fixed">Reais (R$)</option></select></label>
        <label><span>Plano</span><select value={filters.plan} onChange={e => setFilters(previous => ({ ...previous, plan: e.target.value }))}><option value="">Todos</option>{data?.plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
        <button className="button button--secondary" type="submit" disabled={loading}>Filtrar</button><button className="promotion-clear" type="button" disabled={loading} onClick={() => { setFilters(initialFilters); setQuery({ page: 1, pageSize: query.pageSize }); }}>Limpar</button>
      </form>
      {loading ? <div className="billing-skeleton" aria-label="Carregando cupons" aria-busy="true">{[1, 2, 3].map(id => <span key={id} />)}</div> : data?.items.length ? <ul className="promotion-list">{data.items.map(row => <li className="promotion-row" key={row.id}>
        <div className="promotion-row__identity"><button className="promotion-code" onClick={() => void copy(row.code)} aria-label={`Copiar código ${row.code}`}><code>{row.code}</code>{copied === row.code ? <Check size={13} /> : <Copy size={13} />}</button><strong>{row.name}</strong><small>{row.plans.map(id => data.plans.find(plan => plan.id === id)?.name ?? id).join(", ")} · Mensal</small></div>
        <div className="promotion-row__terms"><strong>{row.discountType === "percent" ? `${row.discountValue / 100}%` : brl(row.discountValue)} de desconto</strong><small>{row.duration === "once" ? "Primeira mensalidade" : row.duration === "forever" ? "Todas as mensalidades" : `${row.durationMonths} primeiros meses`}</small><small>{row.timesRedeemed ?? "—"} usos{row.maxRedemptions ? ` de ${row.maxRedemptions}` : " · Sem limite"}</small></div>
        <div className="promotion-row__validity"><small>Início: <time dateTime={row.startsAt}>{dateTime(row.startsAt)}</time></small><small>Fim: <time dateTime={row.expiresAt}>{dateTime(row.expiresAt)}</time></small><span className={`billing-status billing-status--${row.status}`}><span aria-hidden="true" />{statuses[row.status] ?? row.status}</span></div>
        {canWrite && <div className="promotion-row__actions"><button className="promotion-text-button" disabled={!!busyId || row.timesRedeemed !== 0} title={row.timesRedeemed === 0 ? "Editar cupom" : "Cupons já usados preservam as condições. Crie outro para alterar o desconto."} onClick={() => open(row)}>Editar</button>{!["expired", "exhausted"].includes(row.status) && <button className="promotion-text-button" disabled={!!busyId} onClick={() => void mutate(row, row.provisioned ? "toggle" : "retry")}>{busyId === row.id ? "Salvando…" : !row.provisioned ? "Sincronizar" : row.enabled ? "Desabilitar" : "Habilitar"}</button>}<button className="promotion-text-button promotion-text-button--danger" disabled={!!busyId} onClick={() => setDeletingId(row.id)}>Excluir</button></div>}
        {deletingId === row.id && <div className="promotion-delete" role="alert"><p>Excluir o cupom <strong>{row.code}</strong>? Ele deixará de aceitar novos usos. Descontos já concedidos serão mantidos.</p><button className="button button--secondary" disabled={!!busyId} onClick={() => setDeletingId(null)}>Cancelar</button><button className="button button--danger" disabled={!!busyId} onClick={() => void mutate(row, "delete")}>Confirmar exclusão</button></div>}
      </li>)}</ul> : !error && <div className="billing-empty"><TicketPercent size={28} aria-hidden="true" /><h3>{data?.pagination.total === 0 && Object.values(filters).some(Boolean) ? "Nenhum cupom encontrado" : "Nenhum cupom cadastrado"}</h3><p>Crie um cupom ou ajuste os filtros para consultar seus códigos.</p></div>}
      {data && <div className="promotion-pagination"><label><span>Por página</span><select value={query.pageSize} onChange={e => setQuery(previous => ({ ...previous, page: 1, pageSize: Number(e.target.value) }))}><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label><span>{data.pagination.total} cupons · Página {data.pagination.page} de {data.pagination.totalPages}</span><div><button className="button button--secondary" disabled={loading || query.page <= 1} onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))}><ChevronLeft size={15} />Anterior</button><button className="button button--secondary" disabled={loading || query.page >= data.pagination.totalPages} onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))}>Próxima<ChevronRight size={15} /></button></div></div>}
      <p className="promotion-register__note">Desabilitar ou excluir bloqueia novos usos. Cupons já resgatados mantêm as condições da assinatura e não permitem alterar o desconto.</p>
    </section>}
  </div>;
}
