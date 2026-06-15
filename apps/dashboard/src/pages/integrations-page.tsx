import React, { useEffect, useMemo, useState } from "react";
import { KeyRound, RefreshCw, RotateCcw, Send, Trash2, Webhook } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type MerchantApiKey,
  type MerchantProfile,
  type WebhookDelivery,
  type WebhookEndpoint
} from "../api-client.js";

const ALL_EVENTS = [
  "order.approved",
  "customer.upserted",
  "order.tracking.updated",
  "payment.failed",
  "support.ticket.created",
  "checkout.abandoned"
];

const DEFAULT_SCOPES = ["embed:sessions:create", "orders:tracking:write"];

export function IntegrationsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [apiKeys, setApiKeys] = useState<MerchantApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [newKeyName, setNewKeyName] = useState("Backend principal");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["order.approved", "customer.upserted", "order.tracking.updated"]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (e) {
      setMessage(readError(e));
    }
  }

  async function createKey() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createIntegrationApiKey({ name: newKeyName, scopes: DEFAULT_SCOPES });
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

  if (!props.me) {
    return (
      <>
        <h1>Integracoes</h1>
        <p className="page-lead">Login necessario.</p>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Integracoes</h1>
          <p className="page-lead">API keys, webhooks e entregas do tenant.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </header>
      {message ? <p className="panel panel-info">{message}</p> : null}
      {newSecret ? (
        <section className="secret-box">
          <strong>Secret key</strong>
          <code>{newSecret}</code>
        </section>
      ) : null}
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
            <button type="button" disabled={busy} onClick={() => void createKey()}>
              <KeyRound size={16} />
              Criar
            </button>
          </div>
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
