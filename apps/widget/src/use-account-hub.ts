import { useCallback, useEffect, useState } from "react";
import type {
  AgentContext,
  CheckoutSettingsContext,
  DashboardOverview,
  MerchantTheme
} from "@aacp/shared-types";
import type { GlobalAuthSession } from "./widget-schemas.js";

export type AccountHubSection = "summary" | "orders" | "metrics" | "account" | "agent";

interface MerchantProfileSnapshot {
  id: string;
  name: string;
  theme?: MerchantTheme;
}

export interface AccountHubData {
  overview: DashboardOverview | null;
  merchant: MerchantProfileSnapshot | null;
  merchantTheme: MerchantTheme | null;
  checkoutSettings: CheckoutSettingsContext | null;
  agentContext: AgentContext | null;
}

export interface AccountHubState {
  loading: boolean;
  error: string | null;
  section: AccountHubSection;
  data: AccountHubData;
  setSection: (section: AccountHubSection) => void;
  refresh: () => Promise<void>;
}

function headersFromSession(session: GlobalAuthSession): HeadersInit {
  return {
    Authorization: `Bearer ${session.access_token}`,
    "x-device-id": session.user_id
  };
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const reason =
      typeof payload === "object" && payload != null && "message" in payload
        ? String((payload as { message?: unknown }).message ?? "Falha ao carregar o hub.")
        : "Falha ao carregar o hub.";
    throw new Error(reason);
  }
  return payload;
}

export function useAccountHub(options: {
  apiBaseUrl: string;
  session: GlobalAuthSession | null;
  enabled: boolean;
}): AccountHubState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<AccountHubSection>("summary");
  const [data, setData] = useState<AccountHubData>({
    overview: null,
    merchant: null,
    merchantTheme: null,
    checkoutSettings: null,
    agentContext: null
  });

  const refresh = useCallback(async (): Promise<void> => {
    if (!options.session || !options.enabled) return;
    const base = options.apiBaseUrl.replace(/\/$/, "");
    setLoading(true);
    setError(null);
    try {
      const [overview, merchant, merchantTheme, checkoutSettings, agentContext] = await Promise.all([
        fetchJson<DashboardOverview>(`${base}/checkout/dashboard/overview/${options.session.merchant_id}`, {
          headers: headersFromSession(options.session),
          credentials: "include"
        }),
        fetchJson<MerchantProfileSnapshot>(`${base}/merchants/me`, {
          headers: headersFromSession(options.session),
          credentials: "include"
        }),
        fetchJson<MerchantTheme>(`${base}/merchants/me/theme`, {
          headers: headersFromSession(options.session),
          credentials: "include"
        }),
        fetchJson<CheckoutSettingsContext>(`${base}/checkout-settings/context`, {
          headers: headersFromSession(options.session),
          credentials: "include"
        }),
        fetchJson<AgentContext>(`${base}/agent-rules/context`, {
          headers: headersFromSession(options.session),
          credentials: "include"
        })
      ]);

      setData({
        overview,
        merchant,
        merchantTheme,
        checkoutSettings,
        agentContext
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar o hub.");
    } finally {
      setLoading(false);
    }
  }, [options.apiBaseUrl, options.enabled, options.session]);

  useEffect(() => {
    if (!options.enabled || !options.session) return;
    void refresh();
  }, [options.enabled, options.session, refresh]);

  return {
    loading,
    error,
    section,
    data,
    setSection,
    refresh
  };
}
