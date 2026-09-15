import { useState, useEffect, useCallback } from "react";

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

export function useChargebacksPage(apiBaseUrl: string) {
  const [chargebacks, setChargebacks] = useState<OwnChargeback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChargebacks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = `${apiBaseUrl}/payments/chargebacks`;
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as ChargebacksResponse;
      setChargebacks(Array.isArray(data.chargebacks) ? data.chargebacks : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os chargebacks");
      setChargebacks([]);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    fetchChargebacks();
  }, [fetchChargebacks]);

  return {
    chargebacks,
    loading,
    error,
    refetch: fetchChargebacks,
  };
}
