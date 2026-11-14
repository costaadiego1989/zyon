import { useState, useEffect, useCallback, useRef } from "react";

export interface OwnChargeback {
  paymentIntentId: string;
  orderId: string;
  amountCents: number;
  provider: string;
  providerPaymentId: string | null;
  disputeStatus: "pending" | "disputed" | "lost" | "won";
  disputeOpenedAt: string;
  disputeReason: string | null;
}

type ChargebacksResponse = { chargebacks?: OwnChargeback[] };

export function useChargebacksPage(apiBaseUrl: string, enabled = true) {
  const [chargebacks, setChargebacks] = useState<OwnChargeback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const readVersion = useRef(0);

  const fetchChargebacks = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const version = ++readVersion.current;
    setLoading(true);
    setError(null);

    try {
      const url = `${apiBaseUrl}/payments/chargebacks`;
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Você não tem permissão para consultar estas contestações."
            : "Não foi possível consultar as contestações. Tente novamente."
        );
      }

      const data = (await response.json()) as ChargebacksResponse;
      if (version === readVersion.current)
        setChargebacks(Array.isArray(data.chargebacks) ? data.chargebacks : []);
    } catch (err: unknown) {
      if (version === readVersion.current)
        setError(
          err instanceof Error ? err.message : "Não foi possível consultar as contestações. Tente novamente."
        );
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [apiBaseUrl, enabled]);

  useEffect(() => {
    void fetchChargebacks();
    return () => {
      readVersion.current++;
    };
  }, [fetchChargebacks]);

  return {
    chargebacks,
    loading,
    error,
    refetch: fetchChargebacks,
  };
}
