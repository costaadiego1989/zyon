import React, { useEffect, useMemo, useState } from "react";
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
import {
  createDashboardApi,
  DashboardHttpError,
  type MerchantApiKey,
  type MerchantProfile,
  type WebhookDelivery,
  type WebhookEndpoint
} from "../api-client.js";

const ALL_EVENTS = [
  "checkout.started",
  "checkout.abandoned",
  "order.created",
  "order.approved",
  "order.cancelled",
  "payment.pending",
  "payment.approved",
  "payment.failed",
  "payment.refunded",
  "customer.upserted",
  "tracking.updated",
  "support.ticket.created",
  "commerce.connection.degraded",
];

const ALL_SCOPES = [
  "checkout:read",
  "checkout:write",
  "configuration:read",
  "configuration:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "catalog:read",
  "embed:sessions:create",
  "tracking:read",
  "tracking:write",
  "commerce:read",
  "commerce:write",
  "payments:read",
  "support:read",
  "support:write",
  "webhooks:read",
  "webhooks:write",
  "audit:read",
];

const DEFAULT_SCOPES = [
  "catalog:read",
  "embed:sessions:create",
  "orders:read",
  "tracking:write",
  "webhooks:read",
];

export function IntegrationsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [apiKeys, setApiKeys] = useState<MerchantApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [newKeyName, setNewKeyName] = useState("Backend principal");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    "order.approved",
    "customer.upserted",
    "tracking.updated",
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const documentationRoot = useMemo(
    () => apiDocumentationRoot(props.apiBaseUrl),
    [props.apiBaseUrl],
  );
  const quickstart = useMemo(
    () => embedSessionQuickstart(documentationRoot),
    [documentationRoot],
  );

  useEffect(() => {
    if (!props.me) {
      setApiKeys([]);
      setWebhooks([]);
      setDeliveries([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setApiReachable(null);
    setMessage(null);
    try {
      const [keys, endpoints, logs] = await Promise.all([
        api.getIntegrationApiKeys(),
        api.getWebhookEndpoints(),
        api.getWebhookDeliveries(20)
      ]);
      setApiKeys(keys);
      setWebhooks(endpoints);
      setDeliveries(logs);
      setApiReachable(true);
    } catch (e) {
      setApiReachable(false);
      setMessage(readError(e));
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createIntegrationApiKey({
        name: newKeyName,
        scopes: selectedScopes,
      });
      setNewSecret(created.secret_key);
      setApiKeys((prev) => [created.api_key, ...prev]);
      setMessage("Chave criada.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(apiKeyId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const revoked = await api.revokeIntegrationApiKey(apiKeyId);
      setApiKeys((prev) => prev.map((key) => (key.id === apiKeyId ? revoked : key)));
      setMessage("Chave revogada.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createWebhook() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createWebhookEndpoint({ url: webhookUrl, events: selectedEvents, enabled: true });
      setWebhookUrl("");
      setWebhooks((prev) => [created, ...prev]);
      setMessage(created.signingSecret ? `Webhook criado. Segredo ${created.signingSecret}` : "Webhook criado.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function testWebhook(endpointId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const delivery = await api.testWebhookEndpoint(endpointId);
      setDeliveries((prev) => [delivery, ...prev]);
      setMessage("Teste enfileirado.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  async function replay(deliveryId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const current = deliveries.find((item) => item.id === deliveryId);
      if (!current) return;
      const delivery = await api.replayWebhookDelivery(current.endpointId, deliveryId);
      setDeliveries((prev) => prev.map((item) => (item.id === deliveryId ? delivery : item)));
      setMessage("Replay enfileirado.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleEvent(eventName: string) {
    setSelectedEvents((prev) =>
      prev.includes(eventName) ? prev.filter((item) => item !== eventName) : [...prev, eventName]
    );
  }

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((item) => item !== scope)
        : [...prev, scope],
    );
  }

  async function copySecret() {
    if (!newSecret) return;
    await copyText(
      newSecret,
      "Secret key copiada. Ela nao sera exibida novamente.",
      setMessage,
    );
  }

  if (!props.me) {
    return (
      <>
        <h1>Desenvolvedores</h1>
        <p className="page-lead">Login necessario.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Integration API V1</p>
          <h1>Desenvolvedores</h1>
          <p className="page-lead">
            Integre o checkout agentico pelo seu backend com contratos publicos,
            chaves por escopo e webhooks assinados.
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
          <button type="button" disabled={busy || loading} onClick={() => void load()}>
            <RefreshCw size={16} />
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      {newSecret ? (
        <section className="secret-box">
          <div className="panel-title">
            <div>
              <strong>Secret key exibida uma unica vez</strong>
              <span>Armazene-a em um secret manager. Nunca envie para o navegador.</span>
            </div>
            <button type="button" onClick={() => void copySecret()}>
              <Copy size={15} />
              Copiar
            </button>
          </div>
          <code>{newSecret}</code>
        </section>
      ) : null}

      <section className="developer-status-strip" aria-label="Status da integracao">
        <article>
          <Activity size={18} />
          <span>API publica</span>
          <strong>
            {apiReachable === null
              ? "Verificando"
              : apiReachable
                ? "Respondendo"
                : "Indisponivel"}
          </strong>
          <small>{documentationRoot}</small>
        </article>
        <article>
          <KeyRound size={18} />
          <span>Chaves ativas</span>
          <strong>{apiKeys.filter((key) => !key.revokedAt).length}</strong>
          <small>isoladas por tenant e escopo</small>
        </article>
        <article>
          <Webhook size={18} />
          <span>Webhooks ativos</span>
          <strong>{webhooks.filter((endpoint) => endpoint.enabled).length}</strong>
          <small>assinatura HMAC e replay</small>
        </article>
        <article>
          <RotateCcw size={18} />
          <span>Falhas recentes</span>
          <strong>{deliveries.filter((delivery) => delivery.status === "failed").length}</strong>
          <small>ultimas {deliveries.length} entregas</small>
        </article>
      </section>

      <section className="panel developer-quickstart">
        <div>
          <p className="eyebrow">Backend quickstart</p>
          <h2>Emita uma sessao curta para o widget</h2>
          <p>
            A chave vive somente no servidor. O navegador recebe apenas o token
            efemero vinculado ao tenant, origem e escopos permitidos.
          </p>
          <ol className="developer-steps">
            <li>Crie uma chave de sandbox com o menor conjunto de escopos.</li>
            <li>Cadastre a origem permitida em Instalacoes.</li>
            <li>Emita a embed session no seu backend.</li>
            <li>Inicialize o widget com o token retornado.</li>
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
              onClick={() =>
                void copyText(
                  quickstart,
                  "Quickstart copiado.",
                  setMessage,
                )
              }
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
          <div className="panel-title">
            <h2>API keys</h2>
            <KeyRound size={18} />
          </div>
          <div className="form-grid two">
            <label>
              Nome
              <input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} />
            </label>
            <button type="button" disabled={busy || selectedScopes.length === 0} onClick={() => void createKey()}>
              <KeyRound size={16} />
              Criar
            </button>
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
                      <button type="button" disabled={busy || Boolean(key.revokedAt)} onClick={() => void revokeKey(key.id)} title="Revogar">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Crie uma chave de sandbox para iniciar a integracao server-to-server.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel stacked">
          <div className="panel-title">
            <h2>Webhooks</h2>
            <Webhook size={18} />
          </div>
          <label>
            Endpoint
            <input value={webhookUrl} placeholder="https://api.sualoja.com/aacp/webhooks" onChange={(event) => setWebhookUrl(event.target.value)} />
          </label>
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
            Criar webhook
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
              <p className="developer-empty">Cadastre um endpoint HTTPS para receber eventos do checkout.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel stacked" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h2>Delivery log</h2>
          <button type="button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} />
            Recarregar
          </button>
        </div>
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
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={6}>As tentativas de entrega aparecerao aqui apos o primeiro evento.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function readError(error: unknown): string {
  return error instanceof DashboardHttpError ? error.responseBody.slice(0, 180) : error instanceof Error ? error.message : String(error);
}

function apiDocumentationRoot(apiBaseUrl: string): string {
  return apiBaseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

function embedSessionQuickstart(apiRoot: string): string {
  return `curl --request POST '${apiRoot}/v1/embed/sessions' \\
  --header 'Authorization: Bearer aacp_test_REPLACE_ME' \\
  --header 'Content-Type: application/json' \\
  --header 'Idempotency-Key: checkout-{{customer_cart_id}}' \\
  --data '{
    "allowed_origin": "https://checkout.sualoja.com",
    "installation_id": "ins_REPLACE_ME",
    "cart_ref": "cart_REPLACE_ME",
    "scopes": ["checkout:start", "checkout:chat"]
  }'`;
}

async function copyText(
  value: string,
  successMessage: string,
  setMessage: (message: string) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    setMessage(successMessage);
  } catch {
    setMessage("Nao foi possivel copiar automaticamente neste navegador.");
  }
}
