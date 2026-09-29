import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";
import { copyText } from "../utils/clipboard.js";
import { reportError } from "../lib/observability/error-reporter.js";
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
  loadError: string | null;
  messageKind: "error" | "success";
  secretKind: "api" | "webhook";
  busy: boolean;
  loading: boolean;
  apiReachable: boolean | null;
}

export interface IntegrationsPageActions {
  load: () => void;
  createKey: () => void;
  revokeKey: (apiKeyId: string) => Promise<boolean>;
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
    `curl ${root}/v1/products \\`,
    `  -H "Authorization: Bearer YOUR_API_KEY" \\`,
    `  -H "Content-Type: application/json"`,
  ].join("\n");
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

export function useIntegrationsPage(
  apiBaseUrl: string,
  me: MerchantProfile | null
): IntegrationsPageViewModel {
  const api = useApi();
  const [apiKeys, setApiKeys] = useState<MerchantApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationHealth, setInstallationHealth] = useState<Record<string, string>>({});
  const [newKeyName, setNewKeyName] = useState("Backend principal");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [secretKind, setSecretKind] = useState<"api" | "webhook">("api");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([...ALL_SCOPES]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    "order.approved",
    "customer.upserted",
    "tracking.updated",
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"error" | "success">("success");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const working = useRef(false);
  const readVersion = useRef(0);
  const documentationRoot = useMemo(() => apiDocumentationRoot(apiBaseUrl), [apiBaseUrl]);
  const quickstart = useMemo(() => embedSessionQuickstart(documentationRoot), [documentationRoot]);
  const load = useCallback(async () => {
    if (!me || working.current) {
      if (!me) setLoading(false);
      return;
    }
    const version = ++readVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [keys, endpoints, logs] = await Promise.all([
        api.getIntegrationApiKeys(),
        api.getWebhookEndpoints(),
        api.getWebhookDeliveries(20),
      ]);
      if (version !== readVersion.current) return;
      setApiKeys(keys);
      setWebhooks(endpoints);
      setDeliveries(logs);
      setApiReachable(true);
    } catch {
      if (version === readVersion.current) {
        setApiReachable(null);
        setLoadError(
          "Não foi possível consultar as integrações. Tente novamente para conferir o estado atual."
        );
      }
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [api, me?.id]);
  useEffect(() => {
    void load();
    return () => {
      readVersion.current++;
    };
  }, [load]);
  const run = async (action: () => Promise<void>, fallback: string) => {
    if (working.current || loading || loadError) return false;
    working.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessageKind("success");
      return true;
    } catch {
      setMessageKind("error");
      setMessage(fallback);
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const createKey = () =>
    run(async () => {
      if (newSecret || !newKeyName.trim() || !selectedScopes.length) return;
      const created = await api.createIntegrationApiKey({ name: newKeyName.trim(), scopes: selectedScopes });
      setSecretKind("api");
      setNewSecret(created.secret_key);
      setApiKeys((prev) => [created.api_key, ...prev]);
      setMessage("Chave criada. Copie e guarde o segredo antes de fechar.");
    }, "Não foi possível criar a chave. O nome e as permissões foram preservados.");
  const revokeKey = (id: string) =>
    run(async () => {
      const revoked = await api.revokeIntegrationApiKey(id);
      setApiKeys((prev) => prev.map((key) => (key.id === id ? revoked : key)));
      setMessage("Chave revogada. Ela não autoriza mais chamadas à API.");
    }, "Não foi possível revogar a chave. Tente novamente.");
  const createWebhook = () =>
    run(async () => {
      if (newSecret || !selectedEvents.length) return;
      const url = new URL(webhookUrl.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid_url");
      const created = await api.createWebhookEndpoint({
        url: webhookUrl.trim(),
        events: selectedEvents,
        enabled: true,
      });
      setWebhookUrl("");
      setWebhooks((prev) => [created, ...prev]);
      if (created.signingSecret) {
        setSecretKind("webhook");
        setNewSecret(created.signingSecret);
      }
      setMessage("Webhook cadastrado. Use Testar para registrar uma tentativa de entrega.");
    }, "Não foi possível cadastrar o webhook. Confira o endereço e tente novamente; os campos foram preservados.");
  const testWebhook = (id: string) =>
    run(async () => {
      const delivery = await api.testWebhookEndpoint(id);
      setDeliveries((prev) => [delivery, ...prev]);
      setMessage("Teste solicitado. Confira o resultado no histórico de entregas.");
    }, "Não foi possível solicitar o teste. Tente novamente.");
  const replay = (id: string) =>
    run(async () => {
      const current = deliveries.find((d) => d.id === id);
      if (!current) return;
      const delivery = await api.replayWebhookDelivery(current.endpointId, id);
      setDeliveries((prev) => prev.map((d) => (d.id === id ? delivery : d)));
      setMessage("Nova tentativa solicitada. Confira o resultado no histórico de entregas.");
    }, "Não foi possível solicitar o reenvio. Tente novamente.");
  const checkHealth = (id: string) =>
    run(async () => {
      const result = await api.checkInstallationHealth(id);
      setInstallationHealth((prev) => ({ ...prev, [id]: result.status }));
      setMessage("Estado da instalação atualizado.");
    }, "Não foi possível consultar a instalação.");
  const copySecret = async () => {
    if (!newSecret) return;
    const ok = await copyText(newSecret);
    setMessageKind(ok ? "success" : "error");
    setMessage(
      ok
        ? "Segredo copiado. Guarde em local seguro."
        : "Não foi possível copiar. Selecione e copie o segredo manualmente."
    );
  };
  return {
    state: {
      apiKeys,
      webhooks,
      deliveries,
      installations,
      installationHealth,
      newKeyName,
      newSecret,
      secretKind,
      selectedScopes,
      webhookUrl,
      selectedEvents,
      message,
      messageKind,
      loadError,
      busy,
      loading,
      apiReachable,
    },
    actions: {
      load,
      createKey,
      revokeKey,
      createWebhook,
      testWebhook,
      replay,
      checkHealth,
      toggleEvent: (event) =>
        setSelectedEvents((prev) =>
          prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
        ),
      toggleScope: (scope) =>
        setSelectedScopes((prev) =>
          prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
        ),
      copySecret,
      setNewKeyName,
      setWebhookUrl,
      dismissSecret: () => setNewSecret(null),
    },
    computed: {
      activeKeysCount: apiKeys.filter((k) => !k.revokedAt).length,
      activeWebhooksCount: webhooks.filter((w) => w.enabled).length,
      deliverySuccessRate: deliveries.length
        ? Math.round((deliveries.filter((d) => d.status === "delivered").length / deliveries.length) * 100)
        : 0,
      documentationRoot,
      quickstart,
    },
  };
}
