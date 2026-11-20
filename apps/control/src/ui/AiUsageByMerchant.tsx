import { useEffect, useState } from "react";
import { Bot, CalendarRange, CircleAlert, ReceiptText, RefreshCw, Volume2 } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformAiUsageByMerchant,
  type PlatformAiUsageMerchant,
} from "../lib/api.js";

export function AiUsageByMerchant({
  api,
  token,
  onSessionExpired,
}: {
  api: PlatformApi;
  token: string;
  onSessionExpired: () => void;
}) {
  const [report, setReport] = useState<PlatformAiUsageByMerchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [draftRange, setDraftRange] = useState(() => lastDaysRange(30));
  const [appliedRange, setAppliedRange] = useState(() => lastDaysRange(30));

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);

    void api.getAiUsageByMerchant(token, {
      from: saoPauloStartToUtc(appliedRange.from),
      to: saoPauloStartToUtc(shiftDate(appliedRange.to, 1)),
      limit: 100,
    })
      .then(response => {
        if (current) setReport(response);
      })
      .catch(caught => {
        if (!current) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(aiUsageErrorMessage(caught));
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => { current = false; };
  }, [api, appliedRange, onSessionExpired, requestVersion, token]);

  if (loading && !report) return <AiUsageLoading />;
  if (error && !report) return <AiUsageFailure message={error} onRetry={() => setRequestVersion(version => version + 1)} />;
  if (!report) return null;

  return (
    <div className="page-flow">
      <section className="page-intro page-intro--split" aria-labelledby="ai-usage-title">
        <div>
          <p className="eyebrow">Uso de IA por empresa</p>
          <h2 id="ai-usage-title">Chat e voz por empresa</h2>
          <p>{formatUtcPeriod(report.period)}. Chat e capturado no servidor; voz mostra os eventos finais de uso emitidos pelo provedor e encaminhados pela sessao do comprador.</p>
          <form className="metrics-toolbar ai-usage-toolbar" onSubmit={event => {
            event.preventDefault();
            if (draftRange.from > draftRange.to) {
              setError("A data final nao pode ser anterior a data inicial.");
              return;
            }
            setError(null);
            setAppliedRange(draftRange);
          }} aria-label="Periodo do uso de IA">
            <CalendarRange size={17} aria-hidden="true" />
            <label><span>De</span><input type="date" value={draftRange.from} max={draftRange.to} onChange={event => setDraftRange(current => ({ ...current, from: event.target.value }))} /></label>
            <label><span>Ate</span><input type="date" value={draftRange.to} min={draftRange.from} onChange={event => setDraftRange(current => ({ ...current, to: event.target.value }))} /></label>
            <div className="metrics-toolbar__actions">
              <button type="button" className="button button--secondary" onClick={() => { const range = lastDaysRange(7); setDraftRange(range); setAppliedRange(range); }}>7 dias</button>
              <button type="button" className="button button--secondary" onClick={() => { const range = lastDaysRange(30); setDraftRange(range); setAppliedRange(range); }}>30 dias</button>
              <button type="submit" className="button button--primary">Aplicar</button>
            </div>
          </form>
        </div>
        <span className="source-state source-state--partial"><span aria-hidden="true" />Cobertura parcial</span>
      </section>

      <section className="coverage-section" aria-labelledby="ai-usage-coverage-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Escopo da leitura</p>
            <h2 id="ai-usage-coverage-title">O que este relatório mede</h2>
          </div>
          <span className="quiet-note">Fim do período exclusivo</span>
        </div>
        <ul className="coverage-list">
          <li className="coverage-row">
            <span className="coverage-icon"><Bot size={18} aria-hidden="true" /></span>
            <span>
              <strong>Chat disponível</strong>
              <small>{report.coverage.chat.source} · {report.coverage.chat.component.replace("_", " ")} · somente execuções concluídas</small>
            </span>
            <span className="source-state source-state--ready"><span aria-hidden="true" />Capturado no servidor</span>
          </li>
          <li className="coverage-row">
            <span className="coverage-icon"><Volume2 size={18} aria-hidden="true" /></span>
            <span>
              <strong>Voz com cobertura parcial</strong>
              <small>O token temporário vincula a empresa e a sessão. A leitura recebe o uso final do Realtime encaminhado pelo navegador; concilie valores com a fatura do provedor.</small>
            </span>
            <span className="source-state source-state--partial"><span aria-hidden="true" />Uso encaminhado</span>
          </li>
          <li className="coverage-row">
            <span className="coverage-icon"><ReceiptText size={18} aria-hidden="true" /></span>
            <span>
              <strong>Custos precisam de leitura contextual</strong>
              <small>Estimativas usam versões de preço. Eventos sem versão efetiva de preço permanecem separados e não viram custo inferido.</small>
            </span>
            <span className="source-state source-state--partial"><span aria-hidden="true" />Estimado e sem preço</span>
          </li>
        </ul>
      </section>

      <section className="overview-snapshot" aria-labelledby="ai-usage-table-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Empresas</p>
            <h2 id="ai-usage-table-title">Consumo no período</h2>
          </div>
          <span className="quiet-note">{report.items.length} {report.items.length === 1 ? "empresa retornada" : "empresas retornadas"}</span>
        </div>
        {report.items.length === 0 ? <AiUsageEmpty /> : <AiUsageTable items={report.items} />}
      </section>
    </div>
  );
}

function AiUsageTable({ items }: { items: PlatformAiUsageMerchant[] }) {
  return (
    <div className="ai-usage-table-wrap">
      <table className="ai-usage-table">
        <caption className="visually-hidden">Uso de IA de chat e voz por empresa.</caption>
        <thead>
          <tr>
            <th scope="col">Empresa</th>
            <th scope="col">Chat</th>
            <th scope="col">Voz</th>
            <th scope="col">Tokens</th>
            <th scope="col">Estimado</th>
            <th scope="col">Reportado</th>
            <th scope="col">Conciliado</th>
            <th scope="col">Sem preco</th>
          </tr>
        </thead>
        <tbody>{items.map(item => <AiUsageRow key={item.merchant_id} item={item} />)}</tbody>
      </table>
    </div>
  );
}

type AiCostBucket = {
  event_count: string;
  by_currency: Array<{ currency: string; cost_micros: string; event_count: string }>;
};

function AiUsageRow({ item }: { item: PlatformAiUsageMerchant }) {
  const estimated = item.costs.estimated;
  const providerReported = item.costs.provider_reported;
  const reconciled = item.costs.reconciled;
  const unpriced = item.costs.unpriced;
  return (
    <tr>
      <th scope="row" className="ai-usage-table__merchant">
        <span>{item.merchant_name ?? "Empresa sem nome disponivel"}</span>
        <small>{item.merchant_id}</small>
      </th>
      <td><strong>{formatInteger(item.chat.event_count)} chamadas</strong><span>Entrada: {formatInteger(item.chat.prompt_tokens)}</span><span>Saida: {formatInteger(item.chat.completion_tokens)}</span></td>
      <td>
        <strong>{formatInteger(item.voice.response_count)} respostas</strong>
        <span>{formatInteger(item.voice.session_count)} sessoes - {formatInteger(item.voice.component_event_count)} componentes</span>
        <span>Entrada: {formatInteger(item.voice.prompt_tokens)} - Saida: {formatInteger(item.voice.completion_tokens)}</span>
        {item.voice.failed_response_count !== "0" ? <small className="ai-usage-table__note">{formatInteger(item.voice.failed_response_count)} resposta(s) com falha</small> : null}
      </td>
      <td><strong>{formatInteger(sumTokens(item.chat.total_tokens, item.voice.total_tokens))}</strong><span>Chat {formatInteger(item.chat.total_tokens)} - Voz {formatInteger(item.voice.total_tokens)}</span></td>
      <td><CostBucket bucket={estimated} emptyLabel="Nenhum custo estimado" detail="estimados por versao de preco" /></td>
      <td><CostBucket bucket={providerReported} emptyLabel="Nenhum custo reportado" detail="reportados pelo provedor; ainda nao conciliados" /></td>
      <td><CostBucket bucket={reconciled} emptyLabel="Nenhum custo conciliado" detail="conciliados com referencia registrada" /></td>
      <td>
        <strong>{formatInteger(unpriced.event_count)} eventos</strong>
        <span>{formatInteger(unpriced.total_tokens)} tokens sem versao de preco</span>
        {item.costs.other_cost_status_event_count !== "0" ? <small className="ai-usage-table__note">{formatInteger(item.costs.other_cost_status_event_count)} com outro estado de custo</small> : null}
      </td>
    </tr>
  );
}

function CostBucket({ bucket, emptyLabel, detail }: { bucket: AiCostBucket; emptyLabel: string; detail: string }) {
  return <>
    {bucket.by_currency.length > 0 ? bucket.by_currency.map(cost => (
      <span key={cost.currency} className="ai-usage-table__cost">
        <strong>{formatMicros(cost.cost_micros, cost.currency)}</strong>
        <small>{formatInteger(cost.event_count)} eventos</small>
      </span>
    )) : <span>{emptyLabel}</span>}
    <small className="ai-usage-table__note">{formatInteger(bucket.event_count)} eventos {detail}</small>
  </>;
}

function AiUsageLoading() {
  return (
    <section className="overview-snapshot" aria-busy="true" aria-live="polite">
      <div className="section-heading"><div><p className="eyebrow">Uso de IA</p><h2>Carregando consumo por empresa</h2></div></div>
      <div className="feedback-skeleton" aria-hidden="true"><span className="feedback-skeleton__row" /><span className="feedback-skeleton__row" /><span className="feedback-skeleton__row" /></div>
    </section>
  );
}

function AiUsageFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="queue-error" role="alert">
      <CircleAlert size={19} aria-hidden="true" />
      <div><strong>Não foi possível carregar o uso de IA</strong><p>{message}</p></div>
      <button type="button" className="button button--secondary" onClick={onRetry}><RefreshCw size={15} aria-hidden="true" />Tentar novamente</button>
    </section>
  );
}

function AiUsageEmpty() {
  return (
    <div className="feedback-empty">
      <Bot size={23} aria-hidden="true" />
      <h3>Nenhum uso de IA capturado neste período</h3>
      <p>Quando houver chat concluído no servidor ou um evento final de voz encaminhado pelo Realtime, a empresa aparecerá aqui.</p>
    </div>
  );
}

function formatUtcPeriod(period: PlatformAiUsageByMerchant["period"]): string {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const exclusiveEnd = dateInSaoPaulo(new Date(period.to));
  return `${formatter.format(new Date(period.from))} ate ${formatter.format(new Date(`${shiftDate(exclusiveEnd, -1)}T00:00:00-03:00`))} (America/Sao_Paulo)`;
}

function dateInSaoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function lastDaysRange(days: number): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return { from: shiftDate(today, -(days - 1)), to: today };
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function saoPauloStartToUtc(value: string): string {
  return new Date(`${value}T00:00:00-03:00`).toISOString();
}
function formatInteger(value: string): string {
  try {
    return new Intl.NumberFormat("pt-BR").format(BigInt(value));
  } catch {
    return "Indisponível";
  }
}

function sumTokens(...values: string[]): string {
  try {
    return values.reduce((sum, value) => sum + BigInt(value), 0n).toString();
  } catch {
    return "indisponível";
  }
}

function formatMicros(value: string, currency: string): string {
  try {
    const micros = BigInt(value);
    const sign = micros < 0n ? "-" : "";
    const absolute = micros < 0n ? -micros : micros;
    const whole = formatInteger((absolute / 1_000_000n).toString());
    const cents = ((absolute % 1_000_000n) / 10_000n).toString().padStart(2, "0");
    const prefix = currency === "USD" ? "US$" : currency;
    return `${prefix} ${sign}${whole},${cents}`;
  } catch {
    return "Indisponível";
  }
}

function aiUsageErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não possui permissão para consultar o uso de IA por empresa.";
  if (error instanceof PlatformApiError && error.status === 404) return "A fonte de uso de IA ainda não está disponível neste ambiente.";
  return "A consulta à fonte de uso de IA falhou. Tente novamente.";
}
