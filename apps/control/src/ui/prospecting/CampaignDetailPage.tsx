import { useCallback, useState } from "react";
import type { CampaignRecipientRecord } from "@zyon/shared-types";
import { campaignStates } from "./CampaignComposer.js";
import { permissions } from "./ProspectDetailPage.js";
import { blockers, Button, dateTime, ReadState, useAction, useResource, type PageProps } from "./screen-controls.js";
import { ProspectingState } from "./ProspectingShell.js";
import { CampaignMetrics } from "./ProspectingOverview.js";
const states: Record<CampaignRecipientRecord["state"], string> = {
  pending: "Pendente",
  blocked: "Bloqueado",
  prepared: "Preparada",
  reserved: "Reservada",
  submitting: "Em submissão",
  provider_accepted: "Aceita pelo provedor",
  delivered: "Entregue",
  read: "Lida",
  not_accepted: "Recusada pelo provedor",
  outcome_unknown: "Resultado desconhecido",
  cancelled_before_submit: "Cancelada antes do envio",
};
export function CampaignDetailPage(props: PageProps & { id?: string }) {
  return props.id ? <Results key={props.id} {...props} id={props.id} /> : <CampaignList {...props} />;
}
function CampaignList({ api, onSessionExpired, navigate }: PageProps) {
  const [cursor, setCursor] = useState<string>();
  const load = useCallback((s: AbortSignal) => api.campaigns(cursor, s), [api, cursor]);
  const list = useResource(load, onSessionExpired);
  return (
    <section className="prospecting-page">
      <header>
        <h2>Campanhas</h2>
        <p>Acompanhe o envio e revise os públicos preparados.</p>
      </header>
      <div>
        <Button primary onClick={() => navigate({ area: "campaigns", filters: { view: "edit" } })}>
          Preparar campanha
        </Button>
      </div>
      {!list.data ? (
        <ReadState {...list} />
      ) : (
        <>
          {!list.data.items.length && <ProspectingState state="empty" message="Nenhuma campanha criada." />}
          {list.data.items.map((c) => (
            <div key={c.id} className="prospecting-row">
              <Button onClick={() => navigate({ area: "campaigns", id: c.id })}>{c.name}</Button>
              <span>{campaignStates[c.state]}</span>
              <span>{c.recipientCount} destinatários</span>
            </div>
          ))}
          <div className="prospecting-actions">
            {cursor && <Button onClick={() => setCursor(undefined)}>Primeira página</Button>}
            {list.data.nextCursor && <Button onClick={() => setCursor(list.data!.nextCursor!)}>Próxima página</Button>}
          </div>
        </>
      )}
    </section>
  );
}
function Results(props: PageProps & { id: string }) {
  const { api, id, onSessionExpired, navigate } = props;
  const [cursor, setCursor] = useState<string>();
  const [metricsVersion, setMetricsVersion] = useState(0);
  const load = useCallback(
    (s: AbortSignal) => Promise.all([api.campaign(id, s), api.recipients(id, cursor, s)]),
    [api, id, cursor]
  );
  const result = useResource(load, onSessionExpired);
  const action = useAction(props, "campaign." + id, result.reload);
  if (!result.data) return <ReadState {...result} />;
  const [campaign, recipients] = result.data;
  const change = campaign.state === "running" ? "pause" : campaign.state === "paused" ? "resume" : null;
  return (
    <section className="prospecting-page">
      <div>
        <Button onClick={() => navigate({ area: "campaigns" })}>Voltar às campanhas</Button>
      </div>
      <header>
        <h2>{campaign.name}</h2>
        <p>
          {campaignStates[campaign.state]} · Revisão {campaign.revision} · {campaign.recipientCount} destinatários
        </p>
      </header>
      {action.feedback}
      <div className="prospecting-actions">
        <Button onClick={() => navigate({ area: "campaigns", id, filters: { view: "edit" } })}>Revisar campanha</Button>
        {change && (
          <Button
            disabled={action.disabled}
            onClick={() =>
              void action.run(async (key) => {
                const saved = await api.pauseOrResume(id, {
                  clientRequestId: key,
                  expectedRevision: campaign.revision,
                  action: change,
                });
                result.reload();
                return campaignStates[saved.state];
              })
            }
          >
            {change === "pause" ? "Pausar campanha" : "Retomar campanha"}
          </Button>
        )}
        <Button onClick={() => { result.reload(); setMetricsVersion(version => version + 1); }}>Atualizar resultados</Button>
      </div>
      {campaign.blockers.map((b) => (
        <p key={b}>{blockers[b]}</p>
      ))}
      <CampaignMetrics {...props} campaign={campaign} refreshToken={metricsVersion} />
      <h3>Destinatários</h3>
      {!recipients.items.length && (
        <ProspectingState state="empty" message="Nenhum destinatário congelado nesta campanha." />
      )}
      {recipients.items.map((r) => (
        <div key={r.id} className="prospecting-row">
          <div>
            <strong>{r.frozenSnapshot.cnpj}</strong>
            <small>
              {permissions[r.eligibility]} · {r.blockers.map((b) => blockers[b]).join(" · ")}
            </small>
          </div>
          <span>
            {states[r.attemptState ?? r.state]}
            {r.attemptState && r.attemptState !== r.state && " · " + states[r.state]}
          </span>
          <span>
            {r.followUpDueAt ? "Follow-up previsto em " + dateTime(r.followUpDueAt) : "Sem follow-up agendado"}
          </span>
          <Button onClick={() => navigate({ area: "leads", id: r.prospectId })}>Abrir lead</Button>
        </div>
      ))}
      <div className="prospecting-actions">
        {cursor && <Button onClick={() => setCursor(undefined)}>Primeira página</Button>}
        {recipients.nextCursor && <Button onClick={() => setCursor(recipients.nextCursor!)}>Próxima página</Button>}
      </div>
    </section>
  );
}
