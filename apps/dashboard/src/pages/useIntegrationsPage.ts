import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";
import type {
  Installation,
  MerchantApiKey,
  MerchantProfile,
  WebhookDelivery,
  WebhookEndpoint,
} from "../api-client.js";

export const ALL_EVENTS = [
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
] as const;

export const ALL_SCOPES = [
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
] as const;

export interface IntegrationsPageState {
  apiKeys: MerchantApiKey[];
  webhooks: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
  installations: Installation[];
  installationHealth: Record<string, string>;
  newKeyName: string;
  newSecret: string | null;
  selectedScopes: string[];
  webhookUrl: string;
  selectedEvents: string[];
  message: string | null;
  busy: boolean;
  loading: boolean;
  apiReachable: boolean | null;
}

export interface IntegrationsPageActions {
  load: () => void;
  createKey: () => void;
  revokeKey: (apiKeyId: string) => void;
  createWebhook: () => void;
  testWebhook: (endpointId: string) => void;
  replay: (deliveryId: string) => void;
  checkHealth: (installationId: string) => void;
  toggleEvent: (eventName: string) => void;
  toggleScope: (scope: string) => void;
  copySecret: () => void;
  setNewKeyName: (name: string) => void;
  setWebhookUrl: (url: string) => void;
  dismissSecret: () => void;
}

export interface IntegrationsPageComputed {
  activeKeysCount: number;
  activeWebhooksCount: number;
  deliverySuccessRate: number;
  documentationRoot: string;
  quickstart: string;
}

export interface IntegrationsPageViewModel {
  state: IntegrationsPageState;
  actions: IntegrationsPageActions;
  computed: IntegrationsPageComputed;
}

function apiDocumentationRoot(base: string): string {
  return base.replace(/\/$/, "");
}

function embedSessionQuickstart(root: string): string {
  return [
    `curl -X POST ${root}/embed-sessions \\`,
    `  -H "Authorization: Bearer YOUR_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"ttl_seconds": 3600, "allowed_origin": "https://seusite.com"}'`,
  ].join("\n");
}

async function copyText(text: string, successMsg: string, setMsg: (m: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setMsg(successMsg);
  } catch {
    setMsg("Falha ao copiar. Copie manualmente.");
  }
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

export function useIntegrationsPage(apiBaseUrl: string, me: MerchantProfile | null): IntegrationsPageViewModel {
  const api = useApi();
  const [apiKeys, setApiKeys] = useState<MerchantApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationHealth, setInstallationHealth] = useState<Record<string, string>>({});
  const [newKeyName, setNewKeyName] = useState("Backend principal");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([...ALL_SCOPES]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["order.approved", "customer.upserted", "tracking.updated"]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  const documentationRoot = useMemo(() => apiDocumentationRoot(apiBaseUrl), [apiBaseUrl]);
  const quickstart = useMemo(() => embedSessionQuickstart(documentationRoot), [documentationRoot]);

  useEffect(() => {
    if (!me) {
      setApiKeys([]);
      setWebhooks([]);
      setDeliveries([]);
      setInstallations([]);
      return;
    }
    void load();
  }, [me]);

  const load = useCallback(async () => {
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
  }, [api]);

  const createKey = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createIntegrationApiKey({ name: newKeyName, scopes: selectedScopes });
      setNewSecret(created.secret_key);
      setApiKeys((prev) => [created.api_key, ...prev]);
      setMessage("Chave criada.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }, [api, newKeyName, selectedScopes]);

  const revokeKey = useCallback(async (apiKeyId: string) => {
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
  }, [api]);

  const createWebhook = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createWebhookEndpoint({ url: webhookUrl, events: selectedEvents, enabled: true });
      setWebhookUrl("");
      setWebhooks((prev) => [created, ...prev]);
      setMessage(created.signingSecret ? `Webhook criado. Segredo: ${created.signingSecret}` : "Webhook criado.");
    } catch (e) {
      setMessage(readError(e));
    } finally {
      setBusy(false);
    }
  }, [api, webhookUrl, selectedEvents]);

  const testWebhook = useCallback(async (endpointId: string) => {
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
  }, [api]);

  const replay = useCallback(async (deliveryId: string) => {
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
  }, [api, deliveries]);

  const checkHealth = useCallback(async (installationId: string) => {
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
  }, [api]);

  const toggleEvent = useCallback((eventName: string) => {
    setSelectedEvents((prev) => prev.includes(eventName) ? prev.filter((i) => i !== eventName) : [...prev, eventName]);
  }, []);

  const toggleScope = useCallback((scope: string) => {
    setSelectedScopes((prev) => prev.includes(scope) ? prev.filter((i) => i !== scope) : [...prev, scope]);
  }, []);

  const handleCopySecret = useCallback(async () => {
    if (!newSecret) return;
    await copyText(newSecret, "Chave copiada! Guarde em local seguro.", setMessage);
  }, [newSecret]);

  const activeKeysCount = apiKeys.filter((k) => !k.revokedAt).length;
  const activeWebhooksCount = webhooks.filter((w) => w.enabled).length;
  const deliverySuccessRate = deliveries.length > 0
    ? Math.round((deliveries.filter((d) => d.status === "delivered").length / deliveries.length) * 100)
    : 0;

  return {
    state: {
      apiKeys, webhooks, deliveries, installations, installationHealth,
      newKeyName, newSecret, selectedScopes, webhookUrl, selectedEvents,
      message, busy, loading, apiReachable,
    },
    actions: {
      load, createKey, revokeKey, createWebhook, testWebhook, replay, checkHealth,
      toggleEvent, toggleScope, copySecret: handleCopySecret,
      setNewKeyName, setWebhookUrl, dismissSecret: () => setNewSecret(null),
    },
    computed: {
      activeKeysCount, activeWebhooksCount, deliverySuccessRate,
      documentationRoot, quickstart,
    },
  };
}
