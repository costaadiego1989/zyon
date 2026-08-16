"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { WidgetConfigContext, type WidgetConfig, type WidgetConfigState } from "@/lib/widget-config";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

interface WidgetConfigProviderProps {
  merchantId?: string;
  children: ReactNode;
}

/**
 * Fetches checkout settings from the public widget-config endpoint
 * and provides them to all child components via context.
 */
export function WidgetConfigProvider({ merchantId, children }: WidgetConfigProviderProps) {
  const [state, setState] = useState<WidgetConfigState>({
    config: null,
    loading: !!merchantId,
    error: null,
  });

  const fetchConfig = useCallback(async (id: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/checkout-settings/widget-config?merchantId=${encodeURIComponent(id)}`,
      );
      if (!res.ok) {
        setState({ config: null, loading: false, error: `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as WidgetConfig;
      setState({ config: data, loading: false, error: null });
    } catch (err) {
      setState({
        config: null,
        loading: false,
        error: err instanceof Error ? err.message : "fetch_failed",
      });
    }
  }, []);

  useEffect(() => {
    if (!merchantId) {
      setState({ config: null, loading: false, error: null });
      return;
    }
    void fetchConfig(merchantId);
  }, [merchantId, fetchConfig]);

  return (
    <WidgetConfigContext.Provider value={state}>
      {children}
    </WidgetConfigContext.Provider>
  );
}
