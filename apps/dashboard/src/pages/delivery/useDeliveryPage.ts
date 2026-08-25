import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { showToast } from "../../components/Toast.js";
import type { DeliveryConfig, OwnDeliveryConfig, Shipment, ShipmentsPage } from "../../api/endpoints/delivery.js";

const DEFAULT_OWN_DELIVERY: OwnDeliveryConfig = {
  enabled: false,
  mode: "fixed",
  flatPriceCents: 800,
  freeAboveCents: 5000,
  estimatedDays: 1,
  neighborhoods: [],
};

const DEFAULT_CONFIG: DeliveryConfig = {
  melhorEnvioEnabled: false,
  melhorEnvioConnected: false,
  melhorEnvioExpiresAt: null,
  originZip: "",
  ownDelivery: DEFAULT_OWN_DELIVERY,
};

export function useDeliveryPage() {
  const api = useApi();
  const [config, setConfig] = useState<DeliveryConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Shipments state
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentsFilter, setShipmentsFilter] = useState("all");
  const [shipmentsOffset, setShipmentsOffset] = useState(0);
  const [shipmentsTotal, setShipmentsTotal] = useState(0);
  const PAGE_SIZE = 20;

  // Load config + shipments
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [cfgData, shipData] = await Promise.all([
          api.getDeliveryConfig?.().catch((e) => {
            reportError({ source: "delivery.config", error: e });
            return null;
          }),
          api.getShipments?.().catch((e) => {
            reportError({ source: "delivery.shipments", error: e });
            return null;
          }),
        ]);

        if (cancelled) return;

        if (cfgData) setConfig(cfgData);
        if (shipData) {
          setShipments(shipData.items ?? []);
          setShipmentsTotal(shipData.total ?? 0);
        }
      } catch (e) {
        reportError({ source: "delivery.load", error: e });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMelhorEnvio = useCallback(async (enabled: boolean) => {
    setSaving(true);
    const previous = { ...config };
    setConfig((c) => ({ ...c, melhorEnvioEnabled: enabled }));

    try {
      const updated = await api.updateDeliveryConfig?.({
        melhorEnvioEnabled: enabled,
      });
      if (updated) setConfig(updated);
      showToast("success", enabled ? "Melhor Envio ativado" : "Melhor Envio desativado");
    } catch (e) {
      setConfig(previous);
      reportError({ source: "delivery.melhor-envio", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar Melhor Envio");
    } finally {
      setSaving(false);
    }
  }, [api, config]);

  const updateOwnDelivery = useCallback(async (patch: Partial<OwnDeliveryConfig>) => {
    setSaving(true);
    const previous = { ...config };
    const updated = { ...config.ownDelivery, ...patch };
    setConfig((c) => ({ ...c, ownDelivery: updated }));

    try {
      const result = await api.updateDeliveryConfig?.({
        ownDelivery: updated,
      });
      if (result) setConfig(result);
      showToast("success", "Entrega própria atualizada");
    } catch (e) {
      setConfig(previous);
      reportError({ source: "delivery.own-delivery", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar entrega própria");
    } finally {
      setSaving(false);
    }
  }, [api, config]);

  const loadMoreShipments = useCallback(async () => {
    if (shipmentsLoading) return;
    setShipmentsLoading(true);

    try {
      const status = shipmentsFilter !== "all" ? shipmentsFilter : undefined;
      const data = await api.getShipments?.(status, PAGE_SIZE, shipmentsOffset + PAGE_SIZE);
      if (data) {
        setShipments((prev) => [...prev, ...data.items]);
        setShipmentsOffset((prev) => prev + PAGE_SIZE);
      }
    } catch (e) {
      reportError({ source: "delivery.shipments.loadmore", error: e });
      showToast("error", "Erro ao carregar mais entregas");
    } finally {
      setShipmentsLoading(false);
    }
  }, [api, shipmentsFilter, shipmentsOffset]);

  const buyLabel = useCallback(async (shipmentId: string) => {
    try {
      const result = await api.buyShippingLabel?.(shipmentId);
      if (result?.labelUrl) {
        window.open(result.labelUrl, "_blank");
        showToast("success", "Etiqueta gerada com sucesso");
        // Refresh shipments
        const updated = await api.getShipments?.(
          shipmentsFilter !== "all" ? shipmentsFilter : undefined,
          PAGE_SIZE,
          0
        );
        if (updated) {
          setShipments(updated.items);
          setShipmentsOffset(0);
          setShipmentsTotal(updated.total);
        }
      }
    } catch (e) {
      reportError({ source: "delivery.buy-label", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao gerar etiqueta");
    }
  }, [api, shipmentsFilter]);

  const connectMelhorEnvio = useCallback(() => {
    const authorizeUrl = api.getMelhorEnvioAuthorizeUrl?.();
    if (authorizeUrl) {
      window.open(authorizeUrl, "_blank", "width=600,height=700");
    }
  }, [api]);

  return {
    config,
    loading,
    saving,

    // Melhor Envio
    updateMelhorEnvio,
    connectMelhorEnvio,

    // Own Delivery
    updateOwnDelivery,

    // Shipments
    shipments,
    shipmentsLoading,
    shipmentsFilter,
    setShipmentsFilter,
    loadMoreShipments,
    hasMore: shipments.length < shipmentsTotal,
    buyLabel,
  };
}
