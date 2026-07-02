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
  type Installation,
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

  // installations state
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationHealth, setInstallationHealth] = useState<Record<string, string>>({});
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
      setInstallations([]);
      return;
    }
    void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setApiReachable(null);
    setMessage(null);
    try {
      const [keys, endpoints, logs, installs] = await Promise.all([
        api.getIntegrationApiKeys(),
        api.getWebhookEndpoints(),
        api.getWebhookDeliveries(20),
        api.getInstallations().catch(() => [] as Installation[]),
      ]);
      setApiKeys(keys);
      setWebhooks(endpoints);
      setDeliveries(logs);
      setInstallations(installs);
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

  async function checkHealth(installationId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.checkInstallationHealth(installationId);
      setInstallationHealth((prev) => ({ ...prev, [installationId]: result.status }));
      setMessage(`Health: ${result.status}`);
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
      "Guarde esta chave em local seguro. Ela não será exibida novamente.",
      setMessage,
    );
  }

  if (!props.me) {
    return (
      <>
        <h1>Desenvolvedores</h1>
        <p className="page-lead">Login necessário.</p>
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
            Conecte sua plataforma ao Zyon via API, webhooks e tokens de sessão.
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

      <div className="metrics">
        <div className="metric">
          <span><Activity size={14} /> API</span>
          <strong>
            {apiReachable === null
              ? "—"
              : apiReachable
                ? "Online"
                : "Offline"}
          </strong>
        </div>
        <div className="metric">
          <span><KeyRound size={14} /> Chaves</span>
          <strong>{apiKeys.filter((key) => !key.revokedAt).length}</strong>
        </div>
        <div className="metric">
          <span><Webhook size={14} /> Webhooks</span>
          <strong>{webhooks.filter((endpoint) => endpoint.enabled).length}</strong>
        </div>
        <div className="metric">
          <span><RotateCcw size={14} /> Falhas</span>
          <strong>{deliveries.filter((delivery) => delivery.status === "failed").length}</strong>
        </div>
      </div>

      <section className="panel developer-quickstart">
        <div>
          <p className="eyebrow">Backend quickstart</p>
          <h2>Emita uma sessão curta para o widget</h2>
          <p>
            A chave vive somente no servidor. O navegador recebe apenas o token
            efemero vinculado ao tenant, origem e escopos permitidos.
          </p>
          <ol className="developer-steps">
            <li>Crie uma chave de sandbox com o menor conjunto de escopos.</li>
            <li>Cadastre a origem permitida em Instalações.</li>
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
            <h2>Chaves de acesso</h2>
            <KeyRound size={18} />
          </div>
          <p className="section-subtitle">Autentique chamadas à API do Zyon</p>
          <div className="form-grid two">
            <label>
              Nome
              <input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} />
            </label>
            <button type="button" disabled={busy || selectedScopes.length === 0} onClick={() => void createKey()}>
              <KeyRound size={16} />
              Gerar nova chave
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
                      <button type="button" disabled={busy || Boolean(key.revokedAt)} onClick={() => void revokeKey(key.id)} title="Revogar chave">
                        <Trash2 size={14} />
                        Revogar chave
                      </button>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Nenhuma chave criada. Gere uma chave para começar a integrar.</td>
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
          <p className="section-subtitle">Receba notificações em tempo real sobre eventos do checkout</p>
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
              <p className="developer-empty">Nenhum webhook configurado. Adicione um endpoint para receber eventos.</p>
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
                  <td colSpan={6}>As tentativas de entrega aparecerão aqui após o primeiro evento.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stacked" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h2>Tokens de sessão</h2>
          <Activity size={18} />
        </div>
        <p className="section-subtitle" style={{ marginBottom: 8 }}>
          Autentique o widget no seu site
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nome</th>
                <th>Plataforma</th>
                <th>Status</th>
                <th>Health</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {installations.map((inst) => (
                <tr key={inst.id}>
                  <td><code>{inst.id}</code></td>
                  <td>{inst.name ?? "—"}</td>
                  <td>{inst.platform ?? "—"}</td>
                  <td>
                    <span className={inst.status === "active" ? "badge ok" : "badge bad"}>
                      {inst.status}
                    </span>
                  </td>
                  <td>
                    <span className={
                      (installationHealth[inst.id] ?? inst.health) === "healthy" ? "badge ok" :
                      (installationHealth[inst.id] ?? inst.health) === "degraded" ? "badge bad" :
                      "badge muted"
                    }>
                      {installationHealth[inst.id] ?? inst.health ?? "desconhecido"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void checkHealth(inst.id)}
                      title="Verificar health"
                    >
                      <Activity size={14} />
                      Health
                    </button>
                  </td>
                </tr>
              ))}
              {installations.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6}>Nenhuma instalação encontrada.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days}d`;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

export function readError(error: unknown): string {
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
    setMessage("Não foi possível copiar automaticamente neste navegador.");
  }
}
