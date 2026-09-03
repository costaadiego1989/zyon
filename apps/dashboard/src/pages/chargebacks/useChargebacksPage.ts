import { useState, useEffect, useCallback } from "react";

interface Chargeback {
  id: string;
  orderId: string;
  amount: number;
  reason: string;
  status: "opened" | "disputed" | "resolved" | "lost";
  createdAt: string;
  updatedAt: string;
}

export function useChargebacksPage(apiBaseUrl: string, merchantId?: string) {
  const [chargebacks, setChargebacks] = useState<Chargeback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChargebacks = useCallback(async () => {
    if (!merchantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `${apiBaseUrl}/marketplace/dashboard/chargebacks`;
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      // Map the settlement-based response to our UI shape
      const mapped: Chargeback[] = (data.chargebacks || []).map((c: any) => ({
        id: c.settlement?.id ?? c.id,
        orderId: c.settlement?.orderId ?? c.orderId ?? "N/A",
        amount: c.settlement?.sellerNetCents ?? c.amount ?? 0,
        reason: c.type === "chargeback_debt" ? "Chargeback with debt" : "Chargeback cancelled",
        status: c.type === "chargeback_debt" ? "opened" : "resolved",
        createdAt: c.settlement?.chargebackAt ?? c.createdAt ?? new Date().toISOString(),
        updatedAt: c.settlement?.updatedAt ?? c.updatedAt ?? new Date().toISOString(),
      }));
      setChargebacks(mapped);
    } catch (err: any) {
      setError(err?.message || "Failed to load chargebacks");
      setChargebacks([]);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, merchantId]);

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
