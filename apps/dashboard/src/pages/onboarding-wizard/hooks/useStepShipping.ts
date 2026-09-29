import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import type { DeliveryConfig } from "../../../api/endpoints/delivery.js";

export function shippingReady(config: DeliveryConfig | null): boolean {
  if (!config) return false;
  if (config.ownDelivery.enabled) return true;
  const expiry = config.melhorEnvioExpiresAt;
  return config.melhorEnvioEnabled && config.melhorEnvioConnected && (!expiry || new Date(expiry).getTime() > Date.now());
}

export function useStepShipping() {
  const api = useApi();
  const [config, setConfig] = useState<DeliveryConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api.getDeliveryConfig().then(value => {
      if (active) setConfig(value);
    }).catch(() => {
      if (active) { setConfig(null); setError("Não foi possível consultar o frete. Tente novamente para confirmar a configuração."); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, attempt]);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      await api.updateDeliveryConfig({ melhorEnvioEnabled: true, ownDelivery: { enabled: false } });
      window.location.assign(api.getMelhorEnvioAuthorizeUrl("onboarding"));
    } catch {
      setError("Não foi possível iniciar a conexão. Atualize a configuração e tente novamente.");
      setConnecting(false);
    }
  }
  return { config, loading, connecting, error, refresh, connect, ready: !loading && !error && shippingReady(config) };
}
