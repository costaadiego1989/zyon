import { useEffect, useState } from "react";
import { CircleAlert, Filter, ReceiptText, RefreshCw } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformBillingSubscription,
  type PlatformBillingSubscriptionProvider,
  type PlatformBillingSubscriptionsPage,
  type PlatformBillingSubscriptionStatus,
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
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(null);

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

  return (
    <div className="page-flow billing-subscriptions">
      <section className="page-intro page-intro--split">
        <div>
          <p className="eyebrow">Fonte operacional parcial</p>
          <h2>Assinaturas locais</h2>
          <p>Estados locais de assinatura por empresa e provedor.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRequestVersion(value => value + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      <section className="billing-disclosure" aria-labelledby="billing-disclosure-heading">
        <div className="billing-disclosure__icon"><CircleAlert size={19} aria-hidden="true" /></div>
        <div>
          <h3 id="billing-disclosure-heading">Estados de assinatura não definem dívida</h3>
          <p>“Em atraso” e “não paga” são estados locais.</p>
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
      {!error && !loading && page ? <BillingSnapshot page={page} onLoadMore={() => void loadMore()} loadingMore={loadingMore} /> : null}
    </div>
  );
}

function BillingSnapshot({ page, onLoadMore, loadingMore }: {
  page: PlatformBillingSubscriptionsPage;
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

function billingErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para consultar estados locais de assinatura.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de assinaturas não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}

