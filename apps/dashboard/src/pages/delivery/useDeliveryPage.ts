import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { DeliveryConfig, OwnDeliveryConfig, Shipment } from "../../api/endpoints/delivery.js";

const DEFAULT_OWN_DELIVERY: OwnDeliveryConfig = {
  enabled: false,
  mode: "fixed",
  flatPriceCents: 800,
  freeAboveCents: null,
  estimatedValue: 60,
  estimatedUnit: "minutes",
  neighborhoods: [],
  radiusZones: [],
};

const DEFAULT_CONFIG: DeliveryConfig = {
  melhorEnvioEnabled: false,
  melhorEnvioConnected: false,
  melhorEnvioExpiresAt: null,
  originZip: "",
  ownDelivery: DEFAULT_OWN_DELIVERY,
};

function normalizeConfig(raw: Partial<DeliveryConfig> | null | undefined): DeliveryConfig {
  if (!raw) return DEFAULT_CONFIG;
  return {
    melhorEnvioEnabled: raw.melhorEnvioEnabled ?? false,
    melhorEnvioConnected: raw.melhorEnvioConnected ?? false,
    melhorEnvioExpiresAt: raw.melhorEnvioExpiresAt ?? null,
    originZip: raw.originZip ?? "",
    ownDelivery: {
      enabled: raw.ownDelivery?.enabled ?? false,
      mode: raw.ownDelivery?.mode ?? "fixed",
      flatPriceCents: raw.ownDelivery?.flatPriceCents ?? 0,
      freeAboveCents: raw.ownDelivery?.freeAboveCents ?? null,
      estimatedValue: raw.ownDelivery?.estimatedValue ?? 60,
      estimatedUnit: raw.ownDelivery?.estimatedUnit ?? "minutes",
      neighborhoods: raw.ownDelivery?.neighborhoods ?? [],
      radiusZones: raw.ownDelivery?.radiusZones ?? [],
    },
  };
}

export function useDeliveryPage() {
  const api = useApi();
  const [config, setConfig] = useState<DeliveryConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownDeliveryPanelOpen, setOwnDeliveryPanelOpen] = useState(false);
  const configRef = useRef(config);

  configRef.current = config;

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentsError, setShipmentsError] = useState<string | null>(null);
  const [shipmentsFilter, setShipmentsFilter] = useState("all");
  const [shipmentsPage, setShipmentsPage] = useState(1); // 1-based
  const [shipmentsTotal, setShipmentsTotal] = useState(0);
  const PAGE_SIZE = 10;

  useEffect(() => {
    const url = new URL(window.location.href);
    const error = url.searchParams.get("shipping_error");
    const connected = url.searchParams.get("shipping_connected") === "melhor_envio";
    if (error) showToast("error", error === "denied"
      ? "A conexão com o Melhor Envio foi cancelada. Você pode tentar novamente."
      : "Não foi possível conectar o Melhor Envio. Inicie a conexão novamente.");
    if (connected) showToast("success", "Melhor Envio conectado");
    if (error || connected) {
      url.searchParams.delete("shipping_error");
      url.searchParams.delete("shipping_connected");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);

  const reloadConfig = useCallback(async () => {
    setLoading(true);
    setConfigError(null);
    try {
      const cfgData = await api.getDeliveryConfig();
      setConfig(normalizeConfig(cfgData));
    } catch {
      setConfigError("Não foi possível carregar a configuração de entregas.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reloadConfig();
  }, [reloadConfig]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setShipmentsLoading(true);
      setShipmentsError(null);
      try {
        const status = shipmentsFilter !== "all" ? shipmentsFilter : undefined;
        const data = await api.getShipments(status, shipmentsPage, PAGE_SIZE);
        if (cancelled) return;
        setShipments(data.items ?? []);
        setShipmentsTotal(data.total ?? 0);
      } catch {
        if (!cancelled) {
          setShipmentsError("Não foi possível carregar as entregas.");
          showToast("error", "Erro ao carregar entregas");
        }
      } finally {
        if (!cancelled) setShipmentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, shipmentsFilter, shipmentsPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeFilter = useCallback((value: string) => {
    setShipmentsFilter(value);
    setShipmentsPage(1);
  }, []);

  // Toggle Melhor Envio
  const toggleMelhorEnvio = useCallback(async (enabled: boolean) => {
    // Immediate optimistic update — NO revert
    const previous = configRef.current;
    setConfig({
      ...previous,
      melhorEnvioEnabled: enabled,
      ownDelivery: enabled ? { ...previous.ownDelivery, enabled: false } : previous.ownDelivery,
    });

    setSaving(true);
    try {
      await api.updateDeliveryConfig({
        melhorEnvioEnabled: enabled,
        ...(enabled ? { ownDelivery: { enabled: false } } : {}),
      });
      showToast("success", enabled ? "Melhor Envio ativado" : "Melhor Envio desativado");
    } catch {
      setConfig(previous);
      showToast("error", "Erro ao salvar — tente novamente");
    } finally {
      setSaving(false);
    }
  }, [api]);

  // Toggle own delivery
  const toggleOwnDelivery = useCallback(async (enabled: boolean) => {
    // Immediate optimistic update — NO revert
    const previous = configRef.current;
    setConfig({
      ...previous,
      melhorEnvioEnabled: enabled ? false : previous.melhorEnvioEnabled,
      ownDelivery: { ...previous.ownDelivery, enabled },
    });

    if (enabled) setOwnDeliveryPanelOpen(true);

    setSaving(true);
    try {
      await api.updateDeliveryConfig({
        ownDelivery: { enabled },
        ...(enabled ? { melhorEnvioEnabled: false } : {}),
      });
      showToast("success", enabled ? "Entrega própria ativada" : "Entrega própria desativada");
    } catch {
      setConfig(previous);
      showToast("error", "Erro ao salvar — tente novamente");
    } finally {
      setSaving(false);
    }
  }, [api]);

  // Save own delivery config from SidePanel
  const saveOwnDeliveryConfig = useCallback(async (patch: Partial<OwnDeliveryConfig>) => {
    const previous = configRef.current;
    const updated = { ...previous.ownDelivery, ...patch, enabled: true };
    setConfig({ ...previous, ownDelivery: updated });

    setSaving(true);
    try {
      await api.updateDeliveryConfig({ ownDelivery: updated });
      showToast("success", "Configuração salva");
    } catch {
      setConfig(previous);
      showToast("error", "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }, [api]);

  // Connect Melhor Envio — requires toggle active
  const connectMelhorEnvio = useCallback(() => {
    if (!configRef.current.melhorEnvioEnabled) {
      showToast("error", "Ative o Melhor Envio primeiro");
      return;
    }
    const url = api.getMelhorEnvioAuthorizeUrl?.();
    if (url) window.location.assign(url);
  }, [api]);

  return {
    config,
    loading,
    configError,
    reloadConfig,
    saving,
    toggleMelhorEnvio,
    toggleOwnDelivery,
    connectMelhorEnvio,
    ownDeliveryPanelOpen,
    setOwnDeliveryPanelOpen,
    saveOwnDeliveryConfig,
    shipments,
    shipmentsLoading,
    shipmentsError,
    shipmentsFilter,
    setShipmentsFilter: changeFilter,
    shipmentsPage,
    setShipmentsPage,
    shipmentsTotal,
    shipmentsPageSize: PAGE_SIZE,
  };
}
