import { useEffect, useState } from "react";
import { CircleAlert, Database, Gauge, RefreshCw, ServerCog, WifiOff } from "lucide-react";
import {
  PlatformApi,
  PlatformApiError,
  type PlatformInfrastructureReadiness,
  type PlatformInfrastructureReadinessCoverage,
  type PlatformInfrastructureIncident,
  type PlatformInfrastructureIncidentHistory,
} from "../lib/api.js";

type InfrastructureReadinessProps = {
  api: PlatformApi;
  token: string;
  onSessionExpired: () => void;
};

const coverageLabels: Record<keyof PlatformInfrastructureReadiness["coverage"], string> = {
  readiness: "Prontidão atual",
  queues: "Filas",
  external_integrations: "Integrações externas",
  incident_history: "Histórico de incidentes",
};

export function InfrastructureReadiness({ api, token, onSessionExpired }: InfrastructureReadinessProps) {
  const [report, setReport] = useState<PlatformInfrastructureReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void api.getInfrastructureReadiness(token)
      .then(response => {
        if (active) setReport(response);
      })
      .catch(caught => {
        if (!active) return;
        if (caught instanceof PlatformApiError && caught.status === 401) {
          onSessionExpired();
          return;
        }
        setError(infrastructureErrorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [api, onSessionExpired, requestVersion, token]);

  if (loading && !report) return <InfrastructureLoading />;
  if (error && !report) return <InfrastructureFailure message={error} onRetry={() => setRequestVersion(value => value + 1)} />;
  if (!report) return null;

  const currentAlerts = report.current_alerts ?? [];

  return (
    <div className="page-flow infrastructure-readiness">
      <section className="page-intro page-intro--split" aria-labelledby="infrastructure-title">
        <div>
          <p className="eyebrow">Estado da infraestrutura</p>
          <h2 id="infrastructure-title">Prontidão operacional</h2>
          <p>Leitura atual de dependências essenciais, filas e estados persistidos de integração. Ela não substitui a confirmação dos provedores externos.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => setRequestVersion(value => value + 1)} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </section>

      {error ? <InfrastructureFailure message={error} onRetry={() => setRequestVersion(value => value + 1)} /> : null}

      <section className="infrastructure-status" aria-labelledby="infrastructure-status-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Leitura atual</p>
            <h2 id="infrastructure-status-title">Dependências essenciais</h2>
          </div>
          <StatusBadge status={report.readiness.status} />
        </div>
        <dl className="infrastructure-facts">
          <InfrastructureFact icon={<ServerCog size={19} aria-hidden="true" />} label="Prontidão" value={readinessLabel(report.readiness.status)} tone={report.readiness.status === "ready" ? "ready" : "unavailable"} />
          <InfrastructureFact icon={<Database size={19} aria-hidden="true" />} label="Banco de dados" value={databaseLabel(report.readiness.database)} tone={report.readiness.database === "connected" ? "ready" : "unavailable"} />
          <InfrastructureFact icon={<Gauge size={19} aria-hidden="true" />} label="Redis" value={redisLabel(report.readiness.redis)} tone={report.readiness.redis === "connected" ? "ready" : report.readiness.redis === "not_configured" ? "neutral" : "unavailable"} />
        </dl>
        <p className="infrastructure-captured-at">Lido em <time dateTime={report.generated_at}>{formatDateTime(report.generated_at)}</time>.</p>
      </section>

      <section className="infrastructure-observability" aria-labelledby="infrastructure-alerts-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Sinais locais</p>
            <h2 id="infrastructure-alerts-title">Alertas presentes agora</h2>
          </div>
          <AlertStatus alertCount={currentAlerts.length} isAvailable={report.current_alerts !== undefined} />
        </div>
        {report.current_alerts === undefined ? <p className="infrastructure-observability__empty">Esta versão da API ainda não fornece alertas derivados da leitura de infraestrutura.</p> : currentAlerts.length === 0 ? (
          <p className="infrastructure-observability__empty">Nenhum sinal de alerta foi encontrado nesta leitura.</p>
        ) : (
          <ul className="infrastructure-alert-list">
            {currentAlerts.map(alert => <InfrastructureIncidentRow key={alert.id} incident={alert} />)}
          </ul>
        )}
        <p className="infrastructure-observability__note">Os alertas são derivados apenas de sondas locais, contagens BullMQ e estados persistidos. Eles não comprovam a disponibilidade de serviços externos.</p>
      </section>

      <section className="infrastructure-observability" aria-labelledby="queue-observability-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Filas BullMQ</p>
            <h2 id="queue-observability-title">Trabalho pendente e falhas</h2>
          </div>
          <ObservabilityStatus status={report.queues.status} />
        </div>
        {report.queues.queues.length === 0 ? <p className="infrastructure-observability__empty">{queueEmptyMessage(report.queues.status)}</p> : (
          <ul className="infrastructure-queue-list">
            {report.queues.queues.map(queue => <li key={queue.key} className={`infrastructure-queue infrastructure-queue--${queue.status}`}>
              <div>
                <strong>{queue.queue}</strong>
                <small>{queue.description}</small>
              </div>
              {queue.counts ? <dl className="infrastructure-queue__counts">
                <div><dt>Espera</dt><dd>{formatNumber(queue.counts.waiting)}</dd></div>
                <div><dt>Ativos</dt><dd>{formatNumber(queue.counts.active)}</dd></div>
                <div><dt>Falhos</dt><dd>{formatNumber(queue.counts.failed)}</dd></div>
                <div><dt>Atrasados</dt><dd>{formatNumber(queue.counts.delayed)}</dd></div>
              </dl> : <span className="infrastructure-queue__unavailable">Não foi possível consultar</span>}
            </li>)}
          </ul>
        )}
        <p className="infrastructure-observability__note">A sonda mostra contagens no momento da consulta; ela não confirma que os workers estejam processando cada fila.</p>
      </section>

      <section className="infrastructure-observability" aria-labelledby="integrations-observability-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Integrações cadastradas</p>
            <h2 id="integrations-observability-title">Estado persistido de conexões</h2>
          </div>
          <ObservabilityStatus status={report.external_integrations.status} />
        </div>
        {report.external_integrations.status === "available" ? <>
          {(report.external_integrations.connection_states?.length ?? 0) > 0 ? <ul className="infrastructure-integration-list">
            {report.external_integrations.connection_states?.map(connection => <li key={`${connection.surface}-${connection.provider}-${connection.status}`}>
              <span>{integrationSurfaceLabel(connection.surface)}</span>
              <strong>{connection.provider}</strong>
              <small>{connection.status}</small>
              <b>{formatNumber(connection.count)}</b>
            </li>)}
          </ul> : <p className="infrastructure-observability__empty">Nenhuma conexão persistida foi encontrada.</p>}
          {(report.external_integrations.erp_sync_jobs?.length ?? 0) > 0 ? <div className="infrastructure-erp-jobs"><strong>Trabalhos de sincronização ERP</strong><span>{report.external_integrations.erp_sync_jobs?.map(job => `${job.status}: ${formatNumber(job.count)}`).join(" · ")}</span></div> : null}
        </> : <p className="infrastructure-observability__empty">O banco não estava disponível para ler os estados persistidos de integração.</p>}
        <p className="infrastructure-observability__note">São registros locais de conexão e trabalho. O painel não executa chamadas aos provedores nem afirma que eles estão disponíveis.</p>
      </section>

      <section className="infrastructure-observability" aria-labelledby="incident-history-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Observações anteriores</p>
            <h2 id="incident-history-title">Histórico de incidentes locais</h2>
          </div>
          <IncidentHistoryStatus history={report.incident_history} />
        </div>
        {report.incident_history?.status === "available" ? (
          (report.incident_history.items?.length ?? 0) > 0 ? <ul className="infrastructure-incident-list">
            {report.incident_history.items?.map(item => <InfrastructureIncidentRow key={item.id} incident={item} history={item} />)}
          </ul> : <p className="infrastructure-observability__empty">Nenhum alerta foi observado nas leituras já registradas.</p>
        ) : <p className="infrastructure-observability__empty">O histórico local ainda não está disponível nesta leitura.</p>}
        <p className="infrastructure-observability__note">Cada item é consolidado a partir de snapshots gravados quando o painel é lido. “Não observado agora” não confirma resolução e não substitui alertas de monitoramento contínuo.</p>
      </section>

      <section className="coverage-section" aria-labelledby="infrastructure-coverage-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Cobertura da fonte</p>
            <h2 id="infrastructure-coverage-title">O que esta leitura inclui</h2>
          </div>
        </div>
        <ul className="coverage-list">
          {(Object.keys(coverageLabels) as Array<keyof PlatformInfrastructureReadiness["coverage"]>).map(key => (
            <InfrastructureCoverageRow key={key} label={coverageLabels[key]} coverage={report.coverage[key]} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function InfrastructureIncidentRow({
  incident,
  history,
}: {
  incident: PlatformInfrastructureIncident;
  history?: NonNullable<PlatformInfrastructureIncidentHistory["items"]>[number];
}) {
  return (
    <li className="infrastructure-incident" data-severity={incident.severity}>
      <div className="infrastructure-incident__title">
        <CircleAlert size={18} aria-hidden="true" />
        <div>
          <strong>{incident.title}</strong>
          <p>{incident.description}</p>
        </div>
      </div>
      <div className="infrastructure-incident__meta">
        <span className={`infrastructure-severity infrastructure-severity--${incident.severity}`}>{severityLabel(incident.severity)}</span>
        <span>{incidentSourceLabel(incident.source)}</span>
        {history ? <span>{incidentStateLabel(history.state)}</span> : null}
        {history ? <span>{formatNumber(history.observations)} observação(ões)</span> : null}
        {history ? <time dateTime={history.lastObservedAt}>Última: {formatDateTime(history.lastObservedAt)}</time> : null}
      </div>
    </li>
  );
}

function InfrastructureFact({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "ready" | "unavailable" | "neutral" }) {
  return <div className={`infrastructure-fact infrastructure-fact--${tone}`}><dt><span>{icon}</span>{label}</dt><dd>{value}</dd></div>;
}

function InfrastructureCoverageRow({ label, coverage }: { label: string; coverage: PlatformInfrastructureReadinessCoverage }) {
  const available = coverage.status === "available";
  return (
    <li className="coverage-row">
      <span className="coverage-icon">{available ? <ServerCog size={18} aria-hidden="true" /> : <WifiOff size={18} aria-hidden="true" />}</span>
      <span><strong>{label}</strong><small>{coverage.description}</small></span>
      <span className={`source-state source-state--${available ? "ready" : "unavailable"}`}><span aria-hidden="true" />{available ? "Disponível" : "Indisponível"}</span>
    </li>
  );
}

function StatusBadge({ status }: { status: PlatformInfrastructureReadiness["readiness"]["status"] }) {
  const ready = status === "ready";
  return <span className={`source-state source-state--${ready ? "ready" : "unavailable"}`}><span aria-hidden="true" />{ready ? "Pronta" : "Indisponível"}</span>;
}

function ObservabilityStatus({ status }: { status: PlatformInfrastructureReadiness["queues"]["status"] | PlatformInfrastructureReadiness["external_integrations"]["status"] }) {
  const tone = status === "available" ? "ready" : status === "degraded" ? "partial" : "unavailable";
  const label = status === "available" ? "Disponível" : status === "degraded" ? "Parcial" : status === "not_configured" ? "Não configurado" : "Indisponível";
  return <span className={`source-state source-state--${tone}`}><span aria-hidden="true" />{label}</span>;
}

function AlertStatus({ alertCount, isAvailable }: { alertCount: number; isAvailable: boolean }) {
  if (!isAvailable) return <span className="source-state source-state--unavailable"><span aria-hidden="true" />Sem fonte</span>;
  if (alertCount === 0) return <span className="source-state source-state--ready"><span aria-hidden="true" />Nenhum alerta</span>;
  return <span className="source-state source-state--partial"><span aria-hidden="true" />{formatNumber(alertCount)} alerta(s)</span>;
}

function IncidentHistoryStatus({ history }: { history: PlatformInfrastructureIncidentHistory | undefined }) {
  if (history?.status === "available") return <span className="source-state source-state--ready"><span aria-hidden="true" />Disponível</span>;
  return <span className="source-state source-state--unavailable"><span aria-hidden="true" />Indisponível</span>;
}

function InfrastructureLoading() {
  return <section className="overview-snapshot" aria-busy="true" aria-live="polite"><div className="section-heading"><div><p className="eyebrow">Infraestrutura</p><h2>Carregando prontidão operacional</h2></div></div><div className="feedback-skeleton" aria-hidden="true"><span className="feedback-skeleton__row" /><span className="feedback-skeleton__row" /><span className="feedback-skeleton__row" /></div></section>;
}

function InfrastructureFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section className="queue-error" role="alert"><CircleAlert size={19} aria-hidden="true" /><div><strong>Não foi possível carregar a infraestrutura</strong><p>{message}</p></div><button type="button" className="button button--secondary" onClick={onRetry}>Tentar novamente</button></section>;
}

function readinessLabel(value: PlatformInfrastructureReadiness["readiness"]["status"]): string {
  return value === "ready" ? "Pronta" : "Indisponível";
}

function databaseLabel(value: PlatformInfrastructureReadiness["readiness"]["database"]): string {
  return value === "connected" ? "Conectado" : "Desconectado";
}

function redisLabel(value: PlatformInfrastructureReadiness["readiness"]["redis"]): string {
  if (value === "connected") return "Conectado";
  if (value === "not_configured") return "Não configurado";
  return "Desconectado";
}

function queueEmptyMessage(status: PlatformInfrastructureReadiness["queues"]["status"]): string {
  if (status === "not_configured") return "Redis não está configurado neste ambiente, portanto as filas não podem ser consultadas.";
  return "Nenhuma fila pôde ser consultada neste momento.";
}

function integrationSurfaceLabel(surface: NonNullable<PlatformInfrastructureReadiness["external_integrations"]["connection_states"]>[number]["surface"]): string {
  const labels = {
    commerce: "Comércio",
    payments: "Pagamentos",
    erp: "ERP",
    crm: "CRM",
  } as const;
  return labels[surface];
}

function severityLabel(severity: PlatformInfrastructureIncident["severity"]): string {
  return severity === "critical" ? "Crítico" : "Atenção";
}

function incidentSourceLabel(source: PlatformInfrastructureIncident["source"]): string {
  const labels = {
    readiness: "Prontidão",
    queue: "Fila",
    integration: "Integração",
  } as const;
  return labels[source];
}

function incidentStateLabel(state: NonNullable<PlatformInfrastructureIncidentHistory["items"]>[number]["state"]): string {
  return state === "present_in_current_read" ? "Presente agora" : "Não observado agora";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data não disponível";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function infrastructureErrorMessage(error: unknown): string {
  if (error instanceof PlatformApiError && error.status === 403) return "Seu papel não tem permissão para consultar a infraestrutura.";
  if (error instanceof PlatformApiError && error.status === 404) return "A fonte de infraestrutura ainda não está disponível neste ambiente.";
  if (error instanceof PlatformApiError && error.status >= 500) return "A fonte de infraestrutura não respondeu. Tente novamente em instantes.";
  return "Verifique a conexão com a API e tente novamente.";
}
