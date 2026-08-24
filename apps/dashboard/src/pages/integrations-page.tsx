import React from "react";
import { EmptyState } from "../components/EmptyState.js";
import { Button } from "../components/Button.js";
import { StatCard } from "./overview/components/StatCard.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { FormField, FormSelect, FormTextarea } from "../components/FormField.js";
import {
  Activity,
  BookOpenCheck,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Send,
  TerminalSquare,
  Trash2,
  Webhook,
} from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { useIntegrationsPage, ALL_EVENTS, ALL_SCOPES } from "./useIntegrationsPage.js";

export { relativeTime } from "./useIntegrationsPage.js";

export function IntegrationsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const { state, actions, computed } = useIntegrationsPage(props.apiBaseUrl, props.me);
  const {
    apiKeys, webhooks, deliveries, installations, installationHealth,
    newKeyName, newSecret, selectedScopes, webhookUrl, selectedEvents,
    message, busy, loading, apiReachable,
  } = state;
  const {
    load, createKey, revokeKey, createWebhook, testWebhook, replay, checkHealth,
    toggleEvent, toggleScope, copySecret, setNewKeyName, setWebhookUrl, dismissSecret,
  } = actions;
  const { activeKeysCount, activeWebhooksCount, deliverySuccessRate, documentationRoot, quickstart } = computed;

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Integrações</span>
          <h1>API & Webhooks</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Headless Commerce API</p>
          <h1>API & Webhooks</h1>
          <p className="page-lead">
            Gerencie suas API Keys, configure webhooks e acesse a documentação da API headless. ERPs e CRMs consomem seus dados de checkout, catálogo e pedidos por aqui.
          </p>
        </div>
        <div className="developer-actions">
          <a className="developer-link primary" href={`${documentationRoot}/docs`} target="_blank" rel="noreferrer">
            <BookOpenCheck size={16} />
            Abrir Scalar
            <ExternalLink size={13} />
          </a>
          <a className="developer-link" href={`${documentationRoot}/postman.json`} download>
            <Download size={16} />
            Postman
          </a>
        </div>
      </header>

      {message ? <p className="panel panel-info">{message}</p> : null}

      {newSecret ? (
        <section className="secret-box">
          <div className="panel-title">
            <div>
              <strong>Secret key exibida uma única vez</strong>
              <span>Guarde esta chave em local seguro. Ela não será exibida novamente.</span>
            </div>
            <button type="button" onClick={() => void copySecret()}>
              <Copy size={15} />
              Copiar
            </button>
          </div>
          <code>{newSecret}</code>
        </section>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        <StatCard
          label="Status API"
          value={apiReachable === null ? "—" : apiReachable ? "Online" : "Offline"}
          icon={<Activity size={16} />}
          accent={apiReachable ? "var(--color-success)" : "var(--color-error)"}
        />
        <StatCard
          label="Chaves ativas"
          value={activeKeysCount}
          icon={<KeyRound size={16} />}
        />
        <StatCard
          label="Webhooks"
          value={activeWebhooksCount}
          icon={<Webhook size={16} />}
        />
        <StatCard
          label="Deliveries"
          value={deliveries.length}
          icon={<Send size={16} />}
          trend={deliveries.length > 0 ? deliverySuccessRate - 100 : undefined}
        />
      </div>

      <section className="panel developer-quickstart">
        <div>
          <p className="eyebrow">Backend quickstart</p>
          <h2>Consuma a API headless</h2>
          <p>
            Sua API Key vive somente no servidor. Use-a para acessar catálogo, criar sessões de checkout, receber webhooks de pedidos e sincronizar estoque com seu ERP.
          </p>
          <ol className="developer-steps">
            <li>Crie uma API Key com os escopos necessários.</li>
            <li>Configure webhooks para receber eventos em tempo real.</li>
            <li>Consulte catálogo, pedidos e sessões via REST.</li>
            <li>Integre com seu ERP/CRM para sync de estoque e clientes.</li>
          </ol>
          <a className="developer-inline-link" href={`${documentationRoot}/openapi.json`} target="_blank" rel="noreferrer">
            Ver OpenAPI machine-readable
            <ExternalLink size={13} />
          </a>
        </div>
        <div className="developer-code">
          <div className="panel-title">
            <span><TerminalSquare size={15} /> cURL</span>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(quickstart).catch(() => {})}
            >
              <Copy size={14} />
              Copiar
            </button>
          </div>
          <pre className="code-block">{quickstart}</pre>
        </div>
      </section>

      <div className="ops-grid">
        <section className="panel stacked">
          <SectionHeader title="Chaves de acesso" subtitle="Autentique chamadas à API do Zyon" />
          <div>
            <label style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 6 }}>Nome</label>
            <div style={{ display: "flex", gap: 12 }}>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Ex: Backend principal"
                style={{ flex: 1, height: 40, padding: "0 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-sans)" }}
              />
              <button type="button" disabled={busy || selectedScopes.length === 0} onClick={() => void createKey()} className="zyn-btn zyn-btn--primary zyn-btn--md" style={{ height: 40, flexShrink: 0 }}>
                <KeyRound size={14} />
                Gerar nova chave
              </button>
            </div>
          </div>
          <details className="scope-disclosure">
            <summary>
              Escopos da nova chave
              <span>{selectedScopes.length} selecionados</span>
            </summary>
            <div className="chip-row scope-grid">
              {ALL_SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className={selectedScopes.includes(scope) ? "chip selected" : "chip"}
                  aria-pressed={selectedScopes.includes(scope)}
                  onClick={() => toggleScope(scope)}
                >
                  {scope}
                </button>
              ))}
            </div>
          </details>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Prefixo</th>
                  <th>Escopos</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>
                      <code>{key.keyPrefix}</code>
                    </td>
                    <td>{key.scopes.join(", ")}</td>
                    <td>
                      <span className={key.revokedAt ? "badge muted" : "badge ok"}>
                        {key.revokedAt ? "revogada" : "ativa"}
                      </span>
                    </td>
                    <td>
                      <button type="button" disabled={busy || Boolean(key.revokedAt)} onClick={() => void revokeKey(key.id)} title="Revogar chave">
                        <Trash2 size={14} />
                        Revogar chave
                      </button>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState icon={KeyRound} title="Nenhuma chave criada" description="Gere uma chave para começar a integrar." />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel stacked">
          <SectionHeader title="Webhooks" subtitle="Receba notificações em tempo real sobre eventos do checkout" />
          <FormField label="Endpoint" value={webhookUrl} placeholder="https://api.sualoja.com/aacp/webhooks" onChange={setWebhookUrl} />
          <div className="chip-row">
            {ALL_EVENTS.map((eventName) => (
              <button
                key={eventName}
                type="button"
                className={selectedEvents.includes(eventName) ? "chip selected" : "chip"}
                aria-pressed={selectedEvents.includes(eventName)}
                onClick={() => toggleEvent(eventName)}
              >
                {eventName}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy || !webhookUrl.trim()} onClick={() => void createWebhook()}>
            <Webhook size={16} />
            Adicionar endpoint
          </button>
          <div className="list compact-list">
            {webhooks.map((endpoint) => (
              <article key={endpoint.id}>
                <div>
                  <strong>{endpoint.url}</strong>
                  <span>{endpoint.events.join(", ")}</span>
                </div>
                <span className={endpoint.enabled ? "badge ok" : "badge muted"}>{endpoint.enabled ? "ativo" : "pausado"}</span>
                <button type="button" disabled={busy} onClick={() => void testWebhook(endpoint.id)}>
                  <Send size={14} />
                  Testar
                </button>
              </article>
            ))}
            {webhooks.length === 0 ? (
              <EmptyState icon={Webhook} title="Nenhum webhook configurado" description="Adicione um endpoint para receber eventos." />
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel stacked" style={{ marginTop: 16 }}>
        <SectionHeader title="Delivery log" variant="secondary" />
        {deliveries.length === 0 ? (
          <EmptyState icon={Send} title="Nenhuma entrega registrada" description="Tentativas de entrega de webhooks aparecerão aqui após o primeiro evento." />
        ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Evento</th>
                <th>Endpoint</th>
                <th>Status</th>
                <th>Tentativas</th>
                <th>Resposta</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.eventType}</td>
                  <td>{delivery.endpointUrl}</td>
                  <td>
                    <span className={`badge ${delivery.status === "delivered" ? "ok" : delivery.status === "failed" ? "bad" : ""}`}>
                      {delivery.status}
                    </span>
                  </td>
                  <td>{delivery.attempts}</td>
                  <td>{delivery.responseStatus ?? delivery.error ?? "-"}</td>
                  <td>
                    <button type="button" disabled={busy} onClick={() => void replay(delivery.id)}>
                      <RotateCcw size={14} />
                      Replay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

    </>
  );
}
