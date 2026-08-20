import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface ProtocolSession {
  id: string;
  agent_id: string;
  current_state: string;
  created_at: string;
  expires_at: string;
}

export interface WebhookDelivery {
  id: string;
  event_type: string;
  status: "success" | "failed" | "pending";
  attempts: number;
  delivered_at: string;
}

export interface ProtocolConfig {
  protocol_enabled: boolean;
  webhook_url: string;
  ttl_minutes: number;
}

export function useProtocolPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [sessions, setSessions] = useState<ProtocolSession[]>([]);
  const [webhookLogs, setWebhookLogs] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<ProtocolConfig>({ protocol_enabled: false, webhook_url: "", ttl_minutes: 30 });
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [tempConfig, setTempConfig] = useState<ProtocolConfig>({ protocol_enabled: false, webhook_url: "", ttl_minutes: 30 });

  // Load data on mount
  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Mock API calls — replace with real endpoints
        const sessionsData = (await Promise.resolve([])) as ProtocolSession[] | undefined;
        const logsData = (await Promise.resolve([])) as WebhookDelivery[] | undefined;
        if (cancelled) return;
        setSessions(sessionsData ?? []);
        setWebhookLogs(logsData ?? []);
      } catch (e) {
        reportError({ source: "protocol.load", error: e });
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar dados do protocolo");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me]);

  async function handleSaveConfig() {
    if (!tempConfig.webhook_url.trim()) {
      showToast("error", "URL do webhook é obrigatória");
      return;
    }
    setSaving(true);
    try {
      // Mock API call — replace with real endpoint
      setConfig(tempConfig);
      setIsEditingConfig(false);
      showToast("success", "Configuração do protocolo atualizada");
    } catch (e) {
      reportError({ source: "protocol.config", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelConfig() {
    setTempConfig(config);
    setIsEditingConfig(false);
  }

  return {
    sessions,
    webhookLogs,
    loading,
    loaded,
    saving,
    config,
    isEditingConfig,
    tempConfig,
    setTempConfig,
    setIsEditingConfig,
    handleSaveConfig,
    handleCancelConfig,
  };
}
