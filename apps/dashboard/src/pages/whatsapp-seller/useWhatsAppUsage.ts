import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { WhatsAppUsage, WhatsAppUsagePeriod } from "../../api/endpoints/whatsapp-usage.js";
export function useWhatsAppUsage(merchantId?: string) {
  const api = useApi();
  const [period, setPeriod] = useState<WhatsAppUsagePeriod>("month");
  const [result, setResult] = useState<{ key: string; data: WhatsAppUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const key = JSON.stringify([merchantId, period]);
  const refresh = useCallback(async () => {
    if (!merchantId) return;
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const data = await api.getWhatsAppUsage(merchantId, period);
      if (request === generation.current) setResult({ key, data });
    } catch {
      if (request === generation.current) setError("Não foi possível consultar o consumo. Tente atualizar os dados.");
    } finally { if (request === generation.current) setLoading(false); }
  }, [api, merchantId, period, key]);
  useEffect(() => {
    setError(null); void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 60_000);
    return () => { generation.current++; window.clearInterval(timer); };
  }, [refresh]);
  return { data: result?.key === key ? result.data : null, error, loading, period, setPeriod, refresh };
}
