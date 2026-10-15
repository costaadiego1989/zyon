import { useEffect, useMemo, useState } from "react";
import { MerchantRankings } from "./MerchantRankings.js";
import { Bot, CalendarRange, CircleAlert, ReceiptText, RefreshCw, TrendingUp, Volume2 } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformMetricCost,
  type PlatformMetrics,
  type PlatformMetricsGranularity,
} from "../lib/api.js";

type DateRange = { from: string; to: string };

export function PlatformMetricsPanel({
  api,
  token,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  onSessionExpired: () => void;
}) {
  const defaultRange = useMemo(() => lastDaysRange(30), []);
  const [draft, setDraft] = useState<DateRange>(defaultRange);
  const [applied, setApplied] = useState<DateRange>(defaultRange);
  const [granularity, setGranularity] = useState<PlatformMetricsGranularity>("day");
  const [report, setReport] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void api.getMetrics(token, {
      from: saoPauloStartToUtc(applied.from),
      to: saoPauloStartToUtc(shiftDate(applied.to, 1)),
      granularity,
    })
      .then(response => { if (current) setReport(response); })
      .catch(caught => {
        if (!current) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(metricsErrorMessage(caught));
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, applied, granularity, onSessionExpired, requestVersion, token]);

  function applyRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.from > draft.to) {
      setError("A data final nao pode ser anterior a data inicial.");
      return;
    }
    setError(null);
    setApplied(draft);
  }

  function setPreset(days: number) {
    const range = lastDaysRange(days);
    setDraft(range);
    setApplied(range);
  }

  return (
    <section className="overview-snapshot platform-metrics" aria-labelledby="platform-metrics-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Evolucao por periodo</p>
          <h2 id="platform-metrics-title">Receita e consumo de IA</h2>
        </div>
        <span className={`source-state ${report?.coverage.financial.status === "unavailable" ? "source-state--unavailable" : "source-state--partial"}`}><span aria-hidden="true" />Dados parciais</span>
      </div>


      <form className="metrics-toolbar" onSubmit={applyRange} aria-label="Periodo das metricas">
        <CalendarRange size={18} aria-hidden="true" />
        <label>
          <span>De</span>
          <input type="date" value={draft.from} max={draft.to} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} />
        </label>
        <label>
          <span>Ate</span>
          <input type="date" value={draft.to} min={draft.from} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} />
        </label>
        <label>
          <span>Agrupar</span>
          <select value={granularity} onChange={event => setGranularity(event.target.value as PlatformMetricsGranularity)}>
            <option value="day">Por dia</option>
            <option value="month">Por mes</option>
          </select>
        </label>
        <div className="metrics-toolbar__actions">
          <button type="button" className="button button--secondary" onClick={() => setPreset(7)}>7 dias</button>
          <button type="button" className="button button--secondary" onClick={() => setPreset(30)}>30 dias</button>
          <button type="submit" className="button button--primary">Aplicar</button>
        </div>
      </form>

      {loading && !report ? <MetricsLoading /> : null}
      {error && !report ? <MetricsFailure message={error} onRetry={() => setRequestVersion(value => value + 1)} /> : null}
      {report ? <MetricsReport report={report} loading={loading} error={error} onRetry={() => setRequestVersion(value => value + 1)} /> : null}
      <MerchantRankings api={api} token={token} onSessionExpired={onSessionExpired} />
    </section>
  );
}

function MetricsReport({ report, loading, error, onRetry }: { report: PlatformMetrics; loading: boolean; error: string | null; onRetry: () => void }) {
  const received = report.financial.received;
  const current = report.financial.current_position;
  return <div className={`platform-metrics__report ${loading ? "platform-metrics__report--refreshing" : ""}`}>
    {error ? <MetricsFailure message={error} onRetry={onRetry} compact /> : null}
    <p className="platform-metrics__period">{formatPeriod(report.period)}. Fim exclusivo, calendario de {report.period.timezone}.</p>

    <div className="metrics-section-heading">
      <span className="metrics-section-heading__icon"><TrendingUp size={18} aria-hidden="true" /></span>
      <div><strong>Financeiro</strong><small>Receita de assinaturas confirmada e posicao atual</small></div>
    </div>
    {received ? <>
      <dl className="overview-facts metrics-facts">
        <MetricFact label="Recebido no periodo" value={formatBrlCents(received.confirmed_known_amount_cents)} detail={`${formatInteger(received.confirmed_payment_count)} pagamento(s) com estado atual confirmado`} />
        <MetricFact label="MRR contratual" value={formatBrlCents(report.financial.contracted_mrr.known_amount_cents)} detail={mrrDetail(report.financial.contracted_mrr)} />
        <MetricFact label="Saldo vencido agora" value={formatBrlCents(current?.overdue_known_balance_cents ?? null)} detail={current ? `${formatInteger(String(current.overdue_merchant_count))} empresa(s) em atraso` : "Sem posicao atual"} />
        <MetricFact label="Em aberto agora" value={formatBrlCents(current?.open_known_balance_cents ?? null)} detail={current ? `${formatInteger(String(current.open_count))} cobranca(s) ativas` : "Sem posicao atual"} />
      </dl>
      <FinancialSeries points={received.series} granularity={report.period.granularity} />
      {received.incomplete_amount_count !== "0" ? <p className="metrics-note">{formatInteger(received.incomplete_amount_count)} pagamento(s) confirmado(s) sem valor informado pelo evento foram mantidos fora do total monetario.</p> : null}
      {current ? <p className="metrics-note">Posicao atual: {formatInteger(String(current.due_today_count))} vence(m) hoje e {formatInteger(String(current.due_next_7_days_count))} vence(m) nos proximos 7 dias{current.next_due_at ? `; proximo em ${formatDate(current.next_due_at)}` : ""}.</p> : null}
    </> : <UnavailableFinancial coverage={report.coverage.financial} />}

    <div className="metrics-section-heading">
      <span className="metrics-section-heading__icon"><Bot size={18} aria-hidden="true" /></span>
      <div><strong>IA no periodo</strong><small>Chat e voz separados por fonte de captura</small></div>
    </div>
    <dl className="overview-facts metrics-facts metrics-facts--ai">
      <MetricFact label="Chat" value={`${formatInteger(report.ai.chat.total_tokens)} tokens`} detail={`${formatInteger(report.ai.chat.event_count)} execucao(oes); ${formatInteger(report.ai.chat.unpriced_event_count)} sem preco`} />
      <MetricFact label="Voz" value={`${formatInteger(report.ai.voice.total_tokens)} tokens`} detail={`${formatInteger(report.ai.voice.event_count)} componente(s); ${formatInteger(report.ai.voice.unpriced_event_count)} sem preco`} />
      <MetricFact label="Custo de chat" value={formatCosts(report.ai.chat.costs)} detail="Estimado, reportado ou conciliado conforme indicado" />
      <MetricFact label="Custo de voz" value={formatCosts(report.ai.voice.costs)} detail="Pode exigir conciliacao com a fatura do provedor" />
    </dl>
    <AiSeries points={report.ai.series} granularity={report.period.granularity} />

    <div className="metrics-unavailable" role="note">
      <ReceiptText size={18} aria-hidden="true" />
      <p><strong>Taxas da plataforma e resultado apos IA: indisponiveis.</strong> {report.coverage.platform_fees.description}</p>
    </div>
  </div>;
}

function FinancialSeries({ points, granularity }: { points: NonNullable<PlatformMetrics["financial"]["received"]>["series"]; granularity: PlatformMetricsGranularity }) {
  if (points.length === 0) return <MetricEmpty title="Sem pagamentos confirmados neste periodo" detail="A cobertura existe, mas nao houve pagamento com estado atual confirmado nas datas escolhidas." />;
  const highest = points.reduce((maximum, point) => maximum > bigintOrZero(point.confirmed_known_amount_cents) ? maximum : bigintOrZero(point.confirmed_known_amount_cents), 0n);
  return <section className="metrics-series" aria-labelledby="financial-series-title">
    <div className="metrics-series__heading"><div><p className="eyebrow">Serie por {granularity === "day" ? "dia" : "mes"}</p><h3 id="financial-series-title">Pagamentos confirmados</h3></div><span>{points.length} ponto(s)</span></div>
    <ol className="metrics-bars">
      {points.map(point => <li key={point.bucket}>
        <span>{formatBucket(point.bucket, granularity)}</span>
        <meter min="0" max={Number(highest || 1n)} value={Number(bigintOrZero(point.confirmed_known_amount_cents))}>{formatBrlCents(point.confirmed_known_amount_cents)}</meter>
        <strong>{formatBrlCents(point.confirmed_known_amount_cents)}</strong>
        <small>{formatInteger(point.confirmed_payment_count)} pagamento(s)</small>
      </li>)}
    </ol>
  </section>;
}

function AiSeries({ points, granularity }: { points: PlatformMetrics["ai"]["series"]; granularity: PlatformMetricsGranularity }) {
  if (points.length === 0) return <MetricEmpty title="Sem eventos de IA neste periodo" detail="Chat concluido no servidor e eventos finais de voz aparecerao aqui quando forem capturados." />;
  return <section className="metrics-series metrics-series--ai" aria-labelledby="ai-series-title">
    <div className="metrics-series__heading"><div><p className="eyebrow">Serie por {granularity === "day" ? "dia" : "mes"}</p><h3 id="ai-series-title">Tokens e custos de IA</h3></div><span>{points.length} ponto(s)</span></div>
    <div className="metrics-table-wrap">
      <table className="metrics-table">
        <thead><tr><th scope="col">Periodo</th><th scope="col">Chat</th><th scope="col">Voz</th><th scope="col">Tokens</th><th scope="col">Custos conhecidos</th></tr></thead>
        <tbody>{points.map(point => <tr key={point.bucket}>
          <th scope="row">{formatBucket(point.bucket, granularity)}</th>
          <td>{formatInteger(point.chat_event_count)} evento(s)</td>
          <td>{formatInteger(point.voice_event_count)} evento(s)</td>
          <td>{formatInteger(sumStrings(point.chat_total_tokens, point.voice_total_tokens))}</td>
          <td>{formatSeriesCosts(point.costs)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function UnavailableFinancial({ coverage }: { coverage: PlatformMetrics["coverage"]["financial"] }) {
  return <div className="metrics-unavailable">
    <CircleAlert size={19} aria-hidden="true" />
    <p><strong>Aguardando eventos financeiros autenticados.</strong> {coverage.description} Valores permanecem sem dado ate a primeira cobranca observada.</p>
  </div>;
}

function MetricFact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div>;
}

function MetricsLoading() {
  return <div className="metrics-loading" aria-busy="true" aria-live="polite"><span /><span /><span /><span /></div>;
}

function MetricsFailure({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
  return <div className={`metrics-error ${compact ? "metrics-error--compact" : ""}`} role="alert"><CircleAlert size={19} aria-hidden="true" /><p>{message}</p><button type="button" className="button button--secondary" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />Tentar novamente</button></div>;
}

function MetricEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="metrics-empty"><h4>{title}</h4><p>{detail}</p></div>;
}

function lastDaysRange(days: number): DateRange {
  const today = dateInSaoPaulo(new Date());
  return { from: shiftDate(today, -(days - 1)), to: today };
}

function dateInSaoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function saoPauloStartToUtc(value: string): string {
  return new Date(`${value}T00:00:00-03:00`).toISOString();
}

function formatPeriod(period: PlatformMetrics["period"]): string {
  const exclusiveEnd = dateInSaoPaulo(new Date(period.to));
  return `${formatDate(period.from)} ate ${formatDate(saoPauloStartToUtc(shiftDate(exclusiveEnd, -1)))}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "medium" }).format(new Date(value));
}

function formatBucket(bucket: string, granularity: PlatformMetricsGranularity): string {
  const instant = granularity === "month" ? `${bucket}-01T12:00:00-03:00` : `${bucket}T12:00:00-03:00`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: granularity === "month" ? "short" : "2-digit", year: granularity === "month" ? "numeric" : undefined, day: granularity === "month" ? undefined : "2-digit" }).format(new Date(instant));
}

function formatInteger(value: string): string {
  try { return new Intl.NumberFormat("pt-BR").format(BigInt(value)); } catch { return "Indisponivel"; }
}

function formatBrlCents(value: string | null): string {
  if (value === null) return "Sem dados";
  try {
    const cents = BigInt(value);
    const sign = cents < 0n ? "-" : "";
    const absolute = cents < 0n ? -cents : cents;
    return `R$ ${sign}${new Intl.NumberFormat("pt-BR").format(absolute / 100n)},${(absolute % 100n).toString().padStart(2, "0")}`;
  } catch { return "Indisponivel"; }
}

function formatCosts(costs: PlatformMetricCost[]): string {
  if (costs.length === 0) return "Sem custo conhecido";
  const byCurrency = new Map<string, bigint>();
  for (const cost of costs) byCurrency.set(cost.currency, (byCurrency.get(cost.currency) ?? 0n) + bigintOrZero(cost.cost_micros));
  return [...byCurrency].map(([currency, micros]) => formatMicros(micros.toString(), currency)).join(" / ");
}

function formatSeriesCosts(costs: Array<PlatformMetricCost & { channel: "chat" | "voice" }>): string {
  if (costs.length === 0) return "Sem custo conhecido";
  const chat = costs.filter(cost => cost.channel === "chat");
  const voice = costs.filter(cost => cost.channel === "voice");
  return [chat.length ? `Chat: ${formatCosts(chat)}` : "", voice.length ? `Voz: ${formatCosts(voice)}` : ""].filter(Boolean).join("; ");
}

function formatMicros(value: string, currency: string): string {
  try {
    const micros = BigInt(value);
    const sign = micros < 0n ? "-" : "";
    const absolute = micros < 0n ? -micros : micros;
    const prefix = currency === "USD" ? "US$" : currency;
    return `${prefix} ${sign}${new Intl.NumberFormat("pt-BR").format(absolute / 1_000_000n)},${((absolute % 1_000_000n) / 10_000n).toString().padStart(2, "0")}`;
  } catch { return "Indisponivel"; }
}

function bigintOrZero(value: string): bigint {
  try { return BigInt(value); } catch { return 0n; }
}

function sumStrings(...values: string[]): string {
  return values.reduce((total, value) => total + bigintOrZero(value), 0n).toString();
}

function mrrDetail(mrr: PlatformMetrics["financial"]["contracted_mrr"]): string {
  const missing = mrr.active_contract_missing_amount_count;
  return `${mrr.active_contract_with_known_amount_count}/${mrr.active_contract_count} contrato(s) ativo(s) com valor${missing ? `; ${missing} sem valor` : ""}`;
}

function metricsErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 400) return "O periodo informado nao e valido. Use no maximo 366 dias e deixe a data final depois da inicial.";
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel nao possui permissao para consultar as metricas da plataforma.";
  if (error instanceof PlatformApiError && error.status === 404) return "As metricas por periodo ainda nao estao disponiveis neste ambiente.";
  return "A consulta das metricas falhou. Tente novamente.";
}
