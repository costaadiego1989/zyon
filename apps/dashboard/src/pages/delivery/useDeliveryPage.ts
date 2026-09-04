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
  const [saving, setSaving] = useState(false);
  const [ownDeliveryPanelOpen, setOwnDeliveryPanelOpen] = useState(false);
  const configRef = useRef(config);

  configRef.current = config;

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentsFilter, setShipmentsFilter] = useState("all");
  const [shipmentsPage, setShipmentsPage] = useState(1); // 1-based
  const [shipmentsTotal, setShipmentsTotal] = useState(0);
  const PAGE_SIZE = 10;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cfgData = await api.getDeliveryConfig?.().catch(() => null);
        if (!cancelled && cfgData) setConfig(normalizeConfig(cfgData));
      } catch { /* silently use defaults */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setShipmentsLoading(true);
      try {
        const status = shipmentsFilter !== "all" ? shipmentsFilter : undefined;
        const offset = (shipmentsPage - 1) * PAGE_SIZE;
        const data = await api.getShipments?.(status, PAGE_SIZE, offset).catch(() => null);
        if (cancelled || !data) return;
        setShipments(data.items ?? []);
        setShipmentsTotal(data.total ?? 0);
      } catch {
        if (!cancelled) showToast("error", "Erro ao carregar entregas");
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
    setConfig((c) => ({
      ...c,
      melhorEnvioEnabled: enabled,
      ownDelivery: enabled ? { ...c.ownDelivery, enabled: false } : c.ownDelivery,
    }));

    setSaving(true);
    try {
      await api.updateDeliveryConfig?.({
        melhorEnvioEnabled: enabled,
        ...(enabled ? { ownDelivery: { enabled: false } } : {}),
      });
      showToast("success", enabled ? "Melhor Envio ativado" : "Melhor Envio desativado");
    } catch {
      showToast("error", "Erro ao salvar — tente novamente");
    } finally {
      setSaving(false);
    }
  }, [api]);

  // Toggle own delivery
  const toggleOwnDelivery = useCallback(async (enabled: boolean) => {
    // Immediate optimistic update — NO revert
    setConfig((c) => ({
      ...c,
      melhorEnvioEnabled: enabled ? false : c.melhorEnvioEnabled,
      ownDelivery: { ...c.ownDelivery, enabled },
    }));

    if (enabled) setOwnDeliveryPanelOpen(true);

    setSaving(true);
    try {
      await api.updateDeliveryConfig?.({
        ownDelivery: { enabled },
        ...(enabled ? { melhorEnvioEnabled: false } : {}),
      });
      showToast("success", enabled ? "Entrega própria ativada" : "Entrega própria desativada");
    } catch {
      showToast("error", "Erro ao salvar — tente novamente");
    } finally {
      setSaving(false);
    }
  }, [api]);

  // Save own delivery config from SidePanel
  const saveOwnDeliveryConfig = useCallback(async (patch: Partial<OwnDeliveryConfig>) => {
    const updated = { ...configRef.current.ownDelivery, ...patch, enabled: true };
    setConfig((c) => ({ ...c, ownDelivery: updated }));

    setSaving(true);
    try {
      await api.updateDeliveryConfig?.({ ownDelivery: updated });
      showToast("success", "Configuração salva");
    } catch {
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
    if (url) window.open(url, "_blank", "width=600,height=700");
  }, [api]);

  const buyLabel = useCallback(async (shipmentId: string) => {
    try {
      const result = await api.buyShippingLabel?.(shipmentId);
      if (result?.labelUrl) {
        window.open(result.labelUrl, "_blank");
        showToast("success", "Etiqueta gerada");
      }
    } catch {
      showToast("error", "Erro ao gerar etiqueta");
    }
  }, [api]);

  return {
    config,
    loading,
    saving,
    toggleMelhorEnvio,
    toggleOwnDelivery,
    connectMelhorEnvio,
    ownDeliveryPanelOpen,
    setOwnDeliveryPanelOpen,
    saveOwnDeliveryConfig,
    shipments,
    shipmentsLoading,
    shipmentsFilter,
    setShipmentsFilter: changeFilter,
    shipmentsPage,
    setShipmentsPage,
    shipmentsTotal,
    shipmentsPageSize: PAGE_SIZE,
    buyLabel,
  };
}
