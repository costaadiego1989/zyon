import { useCallback, useState } from "react";
import type { ProspectRecord } from "@zyon/shared-types";
import { Button, dateTime, ReadState, useAction, useResource, type PageProps } from "./screen-controls.js";

export function ProspectingPrivacyPage(props: PageProps) {
  const { api, onSessionExpired } = props;
  const policy = useResource(useCallback((signal) => api.privacy(signal), [api]), onSessionExpired);
  const [search, setSearch] = useState("");
  const [selected, select] = useState<ProspectRecord>();
  const leads = useResource(useCallback((signal: AbortSignal) =>
    search ? api.prospects({ search, limit: 10 }, signal) : Promise.resolve({ items: [], nextCursor: null }), [api, search]), onSessionExpired);
  const [reason, setReason] = useState("");
  function refresh() {
    select(undefined);
    setReason("");
    policy.reload();
    leads.reload();
  }
  const action = useAction(props, "privacy", refresh);
  if (!policy.data) return <ReadState {...policy} />;
  const data = policy.data;
  return <section className="prospecting-page">
    <header><h2>Privacidade e retenção</h2></header>
    <section><h3>Dados dos leads</h3>
      <p>Os dados pessoais de leads não convertidos são descartados após {data.retentionDays} dias sem atividade comercial. Uma exceção exige motivo e referência de autorização registrados.</p>
      <p>O bloqueio mínimo do contato é preservado. A reimportação do cadastro público não restaura a permissão de contato. As cópias de segurança expiram conforme o ciclo de armazenamento.</p>
      <dl><dt>Supressões preservadas</dt><dd>{data.preservedSuppressions}</dd>
        <dt>Última execução</dt><dd>{dateTime(data.lastRunAt)}</dd>
        <dt>Próxima execução</dt><dd>{dateTime(data.nextRunAt)}</dd></dl>
      {!data.preservedSuppressions && <p>Nenhuma supressão registrada.</p>}
    </section>
    <section><h3>Bloquear contato</h3>
      <form className="prospecting-actions" onSubmit={event => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("cnpj") ?? "").trim();
        select(undefined); setReason(""); setSearch(value); if (search === value) leads.reload();
      }}>
        <label>CNPJ do lead<input name="cnpj" required /></label><Button type="submit">Localizar lead</Button>
      </form>
      {search && (!leads.data ? <ReadState {...leads} /> : leads.data.items.length === 0 ?
        <p role="status">Nenhum lead encontrado.</p> : leads.data.items.map(lead =>
          <Button key={lead.id} disabled={action.disabled || lead.stage === "do_not_contact"} onClick={() => { select(lead); setReason(""); }}>
            {lead.stage === "do_not_contact" ? "Já bloqueado " : "Bloquear "}{lead.cnpj}
          </Button>))}
      {selected && leads.data && <form onSubmit={event => {
        event.preventDefault();
        if (!reason.trim()) return;
        void action.run(async clientRequestId => {
          const result = await api.suppress(selected.id, { clientRequestId, expectedVersion: selected.version, reason: reason.trim() });
          refresh();
          return "Contato bloqueado. " + result.cancelledAttempts + " tentativa(s) cancelada(s). " + result.inFlightAttempts + " em andamento.";
        });
      }}>
        <p>Confirme o bloqueio de contato do CNPJ <strong>{selected.cnpj}</strong>. Novas abordagens serão impedidas.</p>
        <label>Motivo do bloqueio<input maxLength={200} required value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="prospecting-actions"><Button onClick={() => select(undefined)}>Voltar</Button>
          <Button type="submit" primary disabled={action.disabled || !reason.trim()}>Confirmar bloqueio</Button></div>
      </form>}
      {action.feedback}
    </section>
  </section>;
}
