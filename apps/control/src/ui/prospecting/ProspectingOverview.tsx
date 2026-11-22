import { useCallback, useState } from "react";
import { PROSPECT_METRIC_NAMES, type ProspectMetricName, type ProspectMetricsQuery } from "@zyon/shared-types";
import { Button, dateTime, money, ReadState, useResource, type PageProps } from "./screen-controls.js";
import { ProspectingState, type ProspectRoute } from "./ProspectingShell.js";
const labels: Record<ProspectMetricName, string> = {
  leads: "Leads",
  attempts: "Tentativas de envio",
  accepted: "Aceitas pelo provedor",
  delivered: "Entregas",
  uniqueReplies: "Contatos que responderam",
  signups: "Cadastros",
  trials: "Testes iniciados",
  paidSubscriptions: "Assinaturas pagas líquidas",
  refundedSubscriptions: "Reembolsos integrais",
  unknownAllocationEvents: "Alocação financeira desconhecida",
};
const gaps: Record<string, string> = {
  final_provider_charges: "Cobranças finais indisponíveis",
  multiple_currencies: "Valores em moedas distintas",
  unsettled_usage: "Consumo ainda sem liquidação",
};
function defaultPeriod() {
  const end = new Date();
  end.setUTCHours(24, 0, 0, 0);
  return { from: new Date(+end - 30 * 86400000).toISOString(), to: end.toISOString() };
}
type Props = PageProps & { route: ProspectRoute };
export function ProspectingOverview(props: Props) {
  const [defaultDates] = useState(defaultPeriod);
  const { from = defaultDates.from, to = defaultDates.to, campaignId } = props.route.filters ?? {};
  const metric = props.route.id as ProspectMetricName | undefined;
  return metric && PROSPECT_METRIC_NAMES.includes(metric) ? (
    <Records
      key={JSON.stringify([metric, from, to, campaignId])}
      {...props}
      metric={metric}
      from={from}
      to={to}
      campaignId={campaignId}
    />
  ) : (
    <Overview key={JSON.stringify([from, to, campaignId])} {...props} from={from} to={to} campaignId={campaignId} />
  );
}
function Overview({ api, onSessionExpired, navigate, from, to, campaignId }: Props & ProspectMetricsQuery) {
  const [start, setStart] = useState(from.slice(0, 10)),
    [end, setEnd] = useState(to.slice(0, 10)),
    [campaign, setCampaign] = useState(campaignId ?? "");
  const load = useCallback((s: AbortSignal) => api.metrics({ from, to, campaignId }, s), [api, from, to, campaignId]);
  const result = useResource(load, onSessionExpired);
  const getCampaigns = useCallback(
    async (s: AbortSignal) => {
      const items = [];
      let after: string | undefined;
      do {
        const page = await api.campaigns(after, s);
        items.push(...page.items);
        after = page.nextCursor ?? undefined;
      } while (after);
      return items;
    },
    [api]
  );
  const options = useResource(getCampaigns, onSessionExpired);
  const m = result.data,
    rate = m?.responseRate;
  return (
    <section className="prospecting-page">
      <header>
        <h2>Visão geral</h2>
        <p>Atividade da prospecção no período selecionado.</p>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({
            area: "overview",
            filters: {
              from: new Date(start).toISOString(),
              to: new Date(end).toISOString(),
              ...(campaign ? { campaignId: campaign } : {}),
            },
          });
        }}
      >
        <div className="prospecting-fields">
          <label>
            Início (UTC)
            <input required type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            Fim exclusivo (UTC)
            <input required type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label>
            Campanha
            <select aria-label="Campanha" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">Todas as campanhas</option>
              {options.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button type="submit" primary disabled={!start || !end || start >= end}>
          Aplicar período
        </Button>
      </form>
      {options.error ? <ReadState {...options} /> : null}
      {!m ? (
        <ReadState {...result} />
      ) : (
        <>
          <header>
            <h3>Funil de prospecção</h3>
            <p>
              {m.from.slice(0, 10)} até {m.to.slice(0, 10)} (exclusivo), UTC ·{" "}
              {options.data?.find((c) => c.id === m.campaignId)?.name ?? m.campaignId ?? "Todas as campanhas"} ·
              Atualizado em {dateTime(m.updatedAt)}
            </p>
          </header>
          {!PROSPECT_METRIC_NAMES.some((k) => m[k] > 0) && (
            <ProspectingState state="empty" message="Nenhuma atividade registrada no período." />
          )}
          <div>
            {PROSPECT_METRIC_NAMES.map((k) => (
              <div className="prospecting-row" key={k}>
                <Button
                  onClick={() =>
                    navigate({
                      area: "overview",
                      id: k,
                      filters: { from: m.from, to: m.to, ...(m.campaignId ? { campaignId: m.campaignId } : {}) },
                    })
                  }
                >
                  {labels[k]}
                </Button>
                <strong>{m[k].toLocaleString("pt-BR")}</strong>
              </div>
            ))}
          </div>
          {rate && (
            <section>
              <h3>Taxa de resposta</h3>
              <p>
                {rate.denominator
                  ? ((rate.numerator / rate.denominator) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) +
                    "%"
                  : "Sem base de cálculo"}{" "}
                · {rate.numerator} de {rate.denominator} contatos únicos com entrega no período responderam após a
                entrega.
              </p>
              <small>Coorte atualizada em {dateTime(rate.cohortUpdatedAt)}</small>
            </section>
          )}
          <section>
            <h3>Custos e cobertura</h3>
            <p>Cobertura · {{ complete: "Completa", partial: "Parcial", unknown: "Desconhecida" }[m.costs.coverage]}</p>
            {m.costs.missing.map((g) => (
              <p key={g}>{gaps[g] ?? g}</p>
            ))}
            {m.costs.totals.map((t) => (
              <p key={t.currency}>
                Cobrança final · {money(t.amountCents, t.currency)} ({t.currency})
              </p>
            ))}
            <h4>Compromissos conservadores</h4>
            {!m.costs.commitments.length && <p>Sem compromissos observados.</p>}
            {m.costs.commitments.map((c) => (
              <div key={[c.source, c.state, c.currency].join(".")} className="prospecting-row">
                <span>
                  {c.source === "meta" ? "Meta" : "Modelo"} ·{" "}
                  {{ reserved: "Reservado", unknown: "Desconhecido", committed: "Comprometido" }[c.state]}
                </span>
                <span>
                  {money(c.amountCents, c.currency)} ({c.currency}) · {c.entries} registro(s)
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
function Records({
  api,
  onSessionExpired,
  navigate,
  metric,
  from,
  to,
  campaignId,
}: Props & ProspectMetricsQuery & { metric: ProspectMetricName }) {
  const [cursor, setCursor] = useState<string>();
  const load = useCallback(
    (s: AbortSignal) => api.metricRecords({ from, to, campaignId, metric, cursor, limit: 30 }, s),
    [api, from, to, campaignId, metric, cursor]
  );
  const result = useResource(load, onSessionExpired);
  return (
    <section className="prospecting-page">
      <div>
        <Button
          onClick={() => navigate({ area: "overview", filters: { from, to, ...(campaignId ? { campaignId } : {}) } })}
        >
          Voltar ao funil
        </Button>
      </div>
      <header>
        <h2>{labels[metric]}</h2>
        <p>
          {from.slice(0, 10)} até {to.slice(0, 10)} (exclusivo), UTC · Campanha {campaignId ?? "Todas"}
        </p>
      </header>
      {!result.data ? (
        <ReadState {...result} />
      ) : (
        <>
          {!result.data.items.length && (
            <ProspectingState state="empty" message="Nenhum registro para este indicador no período." />
          )}
          {result.data.items.map((r) => (
            <div key={r.id} className="prospecting-row">
              <div>
                <strong>{r.cnpj ?? "Sem empresa identificada"}</strong>
                <small>{dateTime(r.occurredAt)}</small>
              </div>
              <div className="prospecting-actions">
                {r.prospectId && (
                  <Button onClick={() => navigate({ area: "leads", id: r.prospectId! })}>Abrir lead</Button>
                )}
                {r.conversationId && (
                  <Button onClick={() => navigate({ area: "conversations", id: r.conversationId! })}>
                    Abrir conversa
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="prospecting-actions">
            {cursor && <Button onClick={() => setCursor(undefined)}>Primeira página</Button>}
            {result.data.nextCursor && (
              <Button onClick={() => setCursor(result.data!.nextCursor!)}>Próxima página</Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
