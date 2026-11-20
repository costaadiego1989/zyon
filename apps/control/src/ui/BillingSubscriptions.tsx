import { useEffect, useState } from "react";
import { CircleAlert, Filter, ReceiptText, RefreshCw } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformBillingSubscription,
  type PlatformBillingSubscriptionProvider,
  type PlatformBillingSubscriptionsPage,
  type PlatformBillingSubscriptionStatus,
  type PlatformBillingReceivable,
  type PlatformBillingReceivablesPage,
} from "../lib/api.js";
import "./BillingSubscriptions.css";

const statusLabels: Record<PlatformBillingSubscriptionStatus, string> = {
  trialing: "Em teste",
  starter: "Inicial",
  active: "Ativa",
  past_due: "Em atraso (estado local)",
  unpaid: "Não paga (estado local)",
  paused: "Pausada",
  cancelled: "Cancelada",
  incomplete: "Incompleta",
};

const providerLabels: Record<PlatformBillingSubscriptionProvider, string> = {
  asaas: "Asaas",
  stripe: "Stripe",
  mercadopago: "Mercado Pago",
  unknown: "Não identificado",
};

const sourceLabels = {
  subscription_state: "Estados de assinatura",
  receivables: "Recebíveis",
  delinquency: "Inadimplência",
  next_due_date: "Próximo vencimento",
} as const;

type BillingSubscriptionsProps = {
  api: PlatformApi;
  token: string;
  onSessionExpired: () => void;
};

export function BillingSubscriptions({ api, token, onSessionExpired }: BillingSubscriptionsProps) {
  const [status, setStatus] = useState<PlatformBillingSubscriptionStatus | "">("");
  const [provider, setProvider] = useState<PlatformBillingSubscriptionProvider | "">("");
  const [page, setPage] = useState<PlatformBillingSubscriptionsPage | null>(null);
  const [receivablePage, setReceivablePage] = useState<PlatformBillingReceivablesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [receivablesLoading, setReceivablesLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingMoreReceivables, setLoadingMoreReceivables] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivablesError, setReceivablesError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReceivablesLoading(true);
    setError(null);
    setReceivablesError(null);
    setPage(null);
    setReceivablePage(null);

    void api.listBillingSubscriptions(token, {
      ...(status ? { status } : {}),
      ...(provider ? { provider } : {}),
      limit: 50,
    })
      .then(snapshot => {
        if (!cancelled) setPage(snapshot);
      })
      .catch(caught => {
        if (cancelled) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(billingErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void api.listBillingReceivables(token, { limit: 50 })
      .then(snapshot => {
        if (!cancelled) setReceivablePage(snapshot);
      })
      .catch(caught => {
        if (cancelled) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setReceivablesError(receivablesErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setReceivablesLoading(false);
      });

    return () => { cancelled = true; };
  }, [api, onSessionExpired, provider, requestVersion, status, token]);

  async function loadMore() {
    if (!page?.next_cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);

    try {
      const nextPage = await api.listBillingSubscriptions(token, {
        ...(status ? { status } : {}),
        ...(provider ? { provider } : {}),
        cursor: page.next_cursor,
        limit: 50,
      });
      setPage(current => {
        if (!current) return current;
        const knownIds = new Set(current.items.map(item => item.merchant_id));
        return {
          ...current,
          items: [...current.items, ...nextPage.items.filter(item => !knownIds.has(item.merchant_id))],
          next_cursor: nextPage.next_cursor,
        };
      });
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(billingErrorMessage(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreReceivables() {
    if (!receivablePage?.next_cursor || loadingMoreReceivables) return;
    setLoadingMoreReceivables(true);
    setReceivablesError(null);
    try {
      const nextPage = await api.listBillingReceivables(token, {
        cursor: receivablePage.next_cursor,
        limit: 50,
      });
      setReceivablePage(current => {
        if (!current) return current;
        const knownIds = new Set(current.items.map(item => item.id));
        return {
          ...current,
          items: [...current.items, ...nextPage.items.filter(item => !knownIds.has(item.id))],
          next_cursor: nextPage.next_cursor,
        };
      });
    } catch (caught) {
      if (caught instanceof PlatformApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setReceivablesError(receivablesErrorMessage(caught));
    } finally {
      setLoadingMoreReceivables(false);
    }
  }

  return (
    <div className="page-flow billing-subscriptions">
      <section className="page-intro page-intro--split">
        <div>
          <p className="eyebrow">Fonte operacional parcial</p>
          <h2>Assinaturas locais</h2>
          <p>Estados locais de assinatura e o diário financeiro disponível por fonte.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRequestVersion(value => value + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      <section className="billing-disclosure" aria-labelledby="billing-disclosure-heading">
        <div className="billing-disclosure__icon"><CircleAlert size={19} aria-hidden="true" /></div>
        <div>
          <h3 id="billing-disclosure-heading">Estados de assinatura não definem dívida</h3>
          <p>“Em atraso” e “não paga” são estados locais. Os recebíveis abaixo usam eventos autenticados dos provedores e indicam a própria cobertura antes de qualquer total.</p>
        </div>
      </section>

      <section className="billing-toolbar" aria-label="Filtros de assinaturas locais">
        <Filter size={17} aria-hidden="true" />
        <label>
          <span>Estado local</span>
          <select value={status} onChange={event => setStatus(event.target.value as PlatformBillingSubscriptionStatus | "")} disabled={loading}>
            <option value="">Todos os estados</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Provedor</span>
          <select value={provider} onChange={event => setProvider(event.target.value as PlatformBillingSubscriptionProvider | "")} disabled={loading}>
            <option value="">Todos os provedores</option>
            {Object.entries(providerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </section>

      {error ? <BillingError message={error} onRetry={() => setRequestVersion(value => value + 1)} /> : null}
      {!error && loading ? <BillingSkeleton /> : null}
      {!error && !loading && page ? <BillingSnapshot page={page} receivablePage={receivablePage} receivablesLoading={receivablesLoading} receivablesError={receivablesError} onRetryReceivables={() => setRequestVersion(value => value + 1)} onLoadMoreReceivables={() => void loadMoreReceivables()} loadingMoreReceivables={loadingMoreReceivables} onLoadMore={() => void loadMore()} loadingMore={loadingMore} /> : null}
    </div>
  );
}

function BillingSnapshot({
  page,
  receivablePage,
  receivablesLoading,
  receivablesError,
  onRetryReceivables,
  onLoadMoreReceivables,
  loadingMoreReceivables,
  onLoadMore,
  loadingMore,
}: {
  page: PlatformBillingSubscriptionsPage;
  receivablePage: PlatformBillingReceivablesPage | null;
  receivablesLoading: boolean;
  receivablesError: string | null;
  onRetryReceivables: () => void;
  onLoadMoreReceivables: () => void;
  loadingMoreReceivables: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  const capturedAt = formatDateTime(page.generated_at);

  return (
    <>
      <section className="billing-sources" aria-labelledby="billing-sources-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Limites da fonte</p>
            <h2 id="billing-sources-heading">O que esta consulta representa</h2>
          </div>
          <span className="quiet-note">Lido em {capturedAt}</span>
        </div>
        <ul className="coverage-list">
          {(Object.keys(sourceLabels) as Array<keyof typeof sourceLabels>).map(source => (
            <li key={source} className="coverage-row">
              <span className={`billing-source-icon billing-source-icon--${page.sources[source].status}`} aria-hidden="true"><ReceiptText size={15} /></span>
              <span>
                <strong>{sourceLabels[source]}</strong>
                <small>{page.sources[source].description}</small>
              </span>
              <SourceState status={page.sources[source].status} />
            </li>
          ))}
        </ul>
      </section>

      <section className="billing-facts" aria-labelledby="billing-facts-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Leitura local</p>
            <h2 id="billing-facts-heading">Situação das assinaturas</h2>
          </div>
          <span className="quiet-note">Não representa cobrança recebida</span>
        </div>
        <dl>
          <Fact label="Registros locais" value={page.summary.total_records} />
          <Fact label="Ativas locais" value={page.summary.active_local_records} />
          <Fact label="Em teste" value={page.summary.active_trials} />
          <Fact label="Em atraso" value={page.summary.past_due_local_state_records} note="Estado local; não confirma inadimplência." />
          <Fact label="Cancelamento agendado" value={page.summary.cancellation_at_period_end_records} />
          <Fact label="Sem fim de período" value={page.summary.missing_term_end_records} />
        </dl>
      </section>

      <ReceivableLedger
        page={receivablePage}
        loading={receivablesLoading}
        error={receivablesError}
        onRetry={onRetryReceivables}
        onLoadMore={onLoadMoreReceivables}
        loadingMore={loadingMoreReceivables}
      />

      <section className="billing-records" aria-labelledby="billing-records-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Registros retornados</p>
            <h2 id="billing-records-heading">Empresas e estado de assinatura</h2>
          </div>
          <span className="quiet-note">{page.items.length} exibidos</span>
        </div>
        {page.items.length === 0 ? <EmptySubscriptions /> : <SubscriptionList items={page.items} />}
        {page.next_cursor ? <button type="button" className="button button--secondary billing-load-more" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "Carregando..." : "Carregar mais assinaturas"}</button> : null}
      </section>
    </>
  );
}

function SourceState({ status }: { status: "partial" | "unavailable" }) {
  const label = status === "partial" ? "Parcial" : "Indisponível";
  return <span className={`source-state billing-source-state billing-source-state--${status}`}><span aria-hidden="true" />{label}</span>;
}

function Fact({ label, value, note }: { label: string; value: number; note?: string }) {
  return <div><dt>{label}</dt><dd>{formatNumber(value)}</dd>{note ? <small>{note}</small> : null}</div>;
}

function ReceivableLedger({
  page,
  loading,
  error,
  onRetry,
  onLoadMore,
  loadingMore,
}: {
  page: PlatformBillingReceivablesPage | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  loadingMore: boolean;
}) {
  if (loading) {
    return <section className="billing-records" aria-busy="true" aria-label="Carregando recebíveis"><div className="billing-skeleton">{Array.from({ length: 3 }, (_, index) => <span key={index} />)}</div></section>;
  }
  if (error) {
    return <section className="billing-records"><BillingError message={error} onRetry={onRetry} /></section>;
  }
  if (!page) return null;

  const observedSince = page.coverage.observed_since ? formatDateTime(page.coverage.observed_since) : "Ainda sem eventos";
  return (
    <section className="billing-records" aria-labelledby="receivables-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Diário financeiro parcial</p>
          <h2 id="receivables-heading">Recebíveis observados</h2>
        </div>
        <span className="quiet-note">Cobertura desde {observedSince}</span>
      </div>

      <ul className="coverage-list">
        <CoverageRow label="Cobranças de assinatura Asaas" source={page.sources.asaas_subscription_charges} />
        <CoverageRow label="Cobranças de assinatura Stripe" source={page.sources.stripe_subscription_charges} />
        <CoverageRow label="Cobranças de assinatura Mercado Pago" source={page.sources.mercadopago_subscription_charges} />
        <CoverageRow label="Conciliação financeira" source={page.sources.reconciliation} />
      </ul>

      {!page.coverage.financial_metrics_available ? (
        <div className="billing-empty">
          <ReceiptText size={25} aria-hidden="true" />
          <h3>Aguardando o primeiro evento financeiro</h3>
          <p>Não há eventos de cobrança capturados desde a implantação desta fonte. Os valores não são mostrados como zero.</p>
        </div>
      ) : (
        <>
          <dl className="billing-facts billing-facts--financial">
            <FinancialFact label="Saldo em aberto" value={page.summary.open_balance_cents} note={countLabel(page.summary.open_count, "cobrança")} />
            <FinancialFact label="Saldo vencido" value={page.summary.overdue_balance_cents} note={countLabel(page.summary.overdue_merchant_count, "empresa em atraso", "empresas em atraso")} />
            <FinancialFact label="Vence hoje" value={page.summary.due_today_balance_cents} note={countLabel(page.summary.due_today_count, "cobrança")} />
            <FinancialFact label="Próximos 7 dias" value={page.summary.due_next_7_days_balance_cents} note={countLabel(page.summary.due_next_7_days_count, "cobrança")} />
            <FinancialFact label="Confirmado desde a captura" value={page.summary.confirmed_payment_amount_cents_since_capture} note={countLabel(page.summary.confirmed_payment_count_since_capture, "pagamento")} />
            <FinancialFact label="Próximo vencimento" value={null} displayValue={formatDate(page.summary.next_due_at)} note="Data de calendário do provedor" />
          </dl>
          <p className="quiet-note">Atraso é calculado por vencimento em calendário do provedor e saldo positivo conhecido. Créditos, liquidação e estornos parciais ainda exigem conciliação.</p>
          {page.items.length === 0 ? <EmptyReceivables /> : <ReceivableList items={page.items} />}
          {page.next_cursor ? <button type="button" className="button button--secondary billing-load-more" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? "Carregando..." : "Carregar mais recebíveis"}</button> : null}
        </>
      )}
    </section>
  );
}

function CoverageRow({ label, source }: { label: string; source: { status: "partial" | "unavailable"; description: string } }) {
  return <li className="coverage-row">
    <span className={`billing-source-icon billing-source-icon--${source.status}`} aria-hidden="true"><ReceiptText size={15} /></span>
    <span><strong>{label}</strong><small>{source.description}</small></span>
    <SourceState status={source.status} />
  </li>;
}

function FinancialFact({ label, value, note, displayValue }: { label: string; value: string | null; note: string; displayValue?: string }) {
  return <div><dt>{label}</dt><dd>{displayValue ?? (value === null ? "Sem dados" : formatBrlCents(value))}</dd><small>{note}</small></div>;
}

function ReceivableList({ items }: { items: PlatformBillingReceivable[] }) {
  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead><tr><th scope="col">Empresa</th><th scope="col">Situação financeira</th><th scope="col">Valor</th><th scope="col">Vencimento</th><th scope="col">Último evento</th></tr></thead>
        <tbody>{items.map(item => <ReceivableRow key={item.id} item={item} />)}</tbody>
      </table>
    </div>
  );
}

function ReceivableRow({ item }: { item: PlatformBillingReceivable }) {
  const status = item.is_overdue_as_of ? "overdue" : item.provider_status;
  const label = item.is_overdue_as_of ? "Vencida" : receivableStatusLabels[item.provider_status];
  return (
    <tr>
      <th scope="row"><strong>{item.merchant_name}</strong><small>{providerLabels[item.provider]} - {item.provider_payment_id}</small></th>
      <td><span className={`billing-status billing-status--${status}`}><span aria-hidden="true" />{label}</span></td>
      <td><strong>{item.amount_cents === null ? "Não informado" : formatBrlCents(String(item.amount_cents))}</strong><small>{item.currency}</small></td>
      <td><strong>{formatDate(item.due_at)}</strong><small>{item.paid_at ? `Pago em ${formatDate(item.paid_at)}` : "Data do provedor"}</small></td>
      <td><time dateTime={item.last_provider_event_at}>{formatDateTime(item.last_provider_event_at)}</time></td>
    </tr>
  );
}

function EmptyReceivables() {
  return <div className="billing-empty"><ReceiptText size={25} aria-hidden="true" /><h3>Nenhum recebível para estes filtros</h3><p>Os eventos já capturados não possuem cobranças nesta situação.</p></div>;
}

const receivableStatusLabels = {
  open: "Em aberto",
  overdue: "Vencida",
  paid: "Confirmada",
  cancelled: "Cancelada",
  refunded: "Estornada",
} as const;

function SubscriptionList({ items }: { items: PlatformBillingSubscription[] }) {
  return (
    <div className="billing-table-wrap">
      <table className="billing-table">
        <thead>
          <tr>
            <th scope="col">Empresa</th>
            <th scope="col">Estado local</th>
            <th scope="col">Plano e ciclo</th>
            <th scope="col">Término do período local</th>
            <th scope="col">Último evento de billing</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => <SubscriptionRow key={item.merchant_id} item={item} />)}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionRow({ item }: { item: PlatformBillingSubscription }) {
  const termLabel = item.term_end_kind === "trial" ? "Fim do teste" : item.term_end_kind === "billing_period" ? "Fim do período local" : "Não informado";
  const planLabel = item.plan_key ? item.plan_key[0].toUpperCase() + item.plan_key.slice(1) : "Plano não informado";

  return (
    <tr>
      <th scope="row">
        <strong>{item.merchant_name}</strong>
        <small>{providerLabels[item.provider]}</small>
      </th>
      <td><StatusPill status={item.status} />{item.cancel_at_period_end ? <small className="billing-table__detail">Cancelamento ao fim do período</small> : null}</td>
      <td><strong>{planLabel}</strong><small>{item.billing_cycle === "annual" ? "Ciclo anual" : "Ciclo mensal"}</small></td>
      <td><strong>{formatDate(item.term_ends_at)}</strong><small>{termLabel}</small></td>
      <td>{item.last_billing_event_at ? <time dateTime={item.last_billing_event_at}>{formatDateTime(item.last_billing_event_at)}</time> : <span className="billing-table__unknown">Não informado</span>}</td>
    </tr>
  );
}

function StatusPill({ status }: { status: PlatformBillingSubscriptionStatus }) {
  return <span className={`billing-status billing-status--${status}`}><span aria-hidden="true" />{statusLabels[status]}</span>;
}

function BillingSkeleton() {
  return <div className="billing-skeleton" aria-busy="true" aria-label="Carregando assinaturas locais">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>;
}

function EmptySubscriptions() {
  return <div className="billing-empty"><ReceiptText size={25} aria-hidden="true" /><h3>Nenhuma assinatura encontrada</h3><p>Ajuste os filtros ou aguarde a sincronização de um estado local de assinatura.</p></div>;
}

function BillingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="queue-error" role="alert"><CircleAlert size={20} aria-hidden="true" /><div><strong>Não foi possível carregar as assinaturas</strong><p>{message}</p></div><button type="button" className="button button--secondary" onClick={onRetry}>Tentar novamente</button></div>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBrlCents(value: string): string {
  try {
    const cents = BigInt(value);
    const negative = cents < 0n;
    const absolute = negative ? -cents : cents;
    const whole = absolute / 100n;
    const decimals = String(absolute % 100n).padStart(2, "0");
    return `${negative ? "-" : ""}R$ ${whole.toLocaleString("pt-BR")},${decimals}`;
  } catch {
    return "Não informado";
  }
}

function countLabel(value: number | null, noun: string, pluralNoun = `${noun}s`): string {
  if (value === null) return "Sem dados";
  const plural = value === 1 ? noun : pluralNoun;
  return `${formatNumber(value)} ${plural}`;
}

function billingErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para consultar estados locais de assinatura.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de assinaturas não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}

function receivablesErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para consultar recebíveis.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de recebíveis não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}
