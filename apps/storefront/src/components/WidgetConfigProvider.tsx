"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { WidgetConfigContext, type WidgetConfig, type WidgetConfigState } from "@/lib/widget-config";
import { settingsApi } from "@/lib/api/api-client";

interface WidgetConfigProviderProps {
  merchantId?: string;
  children: ReactNode;
}

/**
 * Fetches checkout settings and provides them to all child components via context.
 * Uses settingsApi (feature-flag driven: internal or v1 path).
 */
export function WidgetConfigProvider({ merchantId, children }: WidgetConfigProviderProps) {
  const [state, setState] = useState<WidgetConfigState>({
    config: null,
    loading: !!merchantId,
    error: null,
  });

  const fetchConfig = useCallback(async (id: string) => {
    try {
      const data = await settingsApi.getCheckoutSettings(id);
      setState({ config: data as WidgetConfig, loading: false, error: null });
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
