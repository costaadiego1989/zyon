import { useCallback, useEffect, useState } from "react";
import type { GlobalAuthSession } from "../lib/widget-schemas.js";
import type { CustomerAddress } from "@aacp/shared-types";

export interface BuyerProfile {
  global_user_id: string;
  display_name: string;
  email: string;
  phone?: string;
  address?: CustomerAddress;
}

export interface BuyerSummary {
  orders_count: number;
  total_spent: number;
  currency: string;
}

export interface BuyerPurchase {
  id: string;
  order_id?: string;
  merchant_name: string;
  tracking_code?: string | null;
  tracking_status?: string | null;
  tracking_url?: string | null;
  carrier?: string | null;
  tracking_events?: BuyerTrackingEvent[];
  total: number;
  discount_amount: number;
  items_count: number;
  items?: BuyerPurchaseItem[];
  currency: string;
  created_at: string;
}

export interface BuyerPurchaseItem {
  sku?: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url?: string | null;
  variant?: string | null;
}

export interface BuyerTrackingEvent {
  status: string;
  description: string;
  location?: string | null;
  occurred_at: string;
}

export type BuyerAgentPersonality = "aggressive" | "balanced" | "conservative";

export interface BuyerAgentProfile {
  agent_name: string;
  personality: BuyerAgentPersonality;
  target_discount_percent: number;
  auto_accept_threshold: number;
}

export interface BuyerHubState {
  profile: BuyerProfile | null;
  summary: BuyerSummary | null;
  purchases: BuyerPurchase[];
  agent: BuyerAgentProfile | null;
  loading: boolean;
  error: string | null;
  hasMorePurchases: boolean;
  refresh: () => Promise<void>;
  loadMorePurchases: () => Promise<void>;
  saveProfile: (data: Partial<Pick<BuyerProfile, "display_name" | "phone" | "address">>) => Promise<void>;
  saveAgent: (data: Partial<BuyerAgentProfile>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const msg =
      typeof payload === "object" && payload != null && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : "Falha ao carregar dados.";
    throw new Error(msg);
  }
  return payload;
}

function buyerHeaders(session: GlobalAuthSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`
  };
}

function purchasesUrl(base: string, merchantId: string | undefined, cursor?: string | null): string {
  const params = new URLSearchParams({ limit: "10" });
  if (merchantId) params.set("merchant_id", merchantId);
  if (cursor) params.set("cursor", cursor);
  return `${base}/buyer/me/purchases?${params.toString()}`;
}

export function useBuyerHub(options: {
  apiBaseUrl: string;
  session: GlobalAuthSession | null;
  merchantId?: string;
  enabled: boolean;
  onAuthExpired?: () => void;
}): BuyerHubState {
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [summary, setSummary] = useState<BuyerSummary | null>(null);
  const [purchases, setPurchases] = useState<BuyerPurchase[]>([]);
  const [agent, setAgent] = useState<BuyerAgentProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMorePurchases, setHasMorePurchases] = useState(false);

  const base = options.apiBaseUrl.replace(/\/$/, "");
  const merchantScope = options.session?.merchant_id ?? options.merchantId;

  const refresh = useCallback(async (): Promise<void> => {
    if (!options.session || !options.enabled) return;
    const headers = buyerHeaders(options.session);
    setLoading(true);
    setError(null);
    try {
      const [profileData, summaryData, purchasesData, agentData] = await Promise.all([
        fetchJson<BuyerProfile>(`${base}/buyer/me`, { headers, credentials: "include" }),
        fetchJson<BuyerSummary>(`${base}/buyer/me/summary`, { headers, credentials: "include" }).catch(() => null),
        fetchJson<{ items: BuyerPurchase[]; next_cursor?: string }>(
          purchasesUrl(base, merchantScope),
          { headers, credentials: "include" }
        ).catch(() => ({ items: [], next_cursor: undefined })),
        fetchJson<BuyerAgentProfile>(`${base}/buyer/me/agent`, { headers, credentials: "include" }).catch(() => null)
      ]);
      setProfile(profileData);
      setSummary(summaryData);
      setPurchases(purchasesData.items ?? []);
      setCursor(purchasesData.next_cursor ?? null);
      setHasMorePurchases(Boolean(purchasesData.next_cursor));
      setAgent(agentData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar o hub.";
      if (message === "buyer_account_not_found") {
        options.onAuthExpired?.();
        setError("Sua sessão expirou. Entre novamente para acessar sua conta.");
        return;
      }
      if (/invalid_bearer_token|missing_bearer_token|jwt expired|unauthorized/i.test(message)) {
        options.onAuthExpired?.();
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [base, merchantScope, options.enabled, options.onAuthExpired, options.session]);

  const loadMorePurchases = useCallback(async (): Promise<void> => {
    if (!options.session || !cursor) return;
    const headers = buyerHeaders(options.session);
    try {
      const data = await fetchJson<{ items: BuyerPurchase[]; next_cursor?: string }>(
        purchasesUrl(base, merchantScope, cursor),
        { headers, credentials: "include" }
      );
      setPurchases((prev) => [...prev, ...(data.items ?? [])]);
      setCursor(data.next_cursor ?? null);
      setHasMorePurchases(Boolean(data.next_cursor));
    } catch {
      // non-critical — keep existing purchases
    }
  }, [base, cursor, merchantScope, options.session]);

  const saveProfile = useCallback(
    async (data: Partial<Pick<BuyerProfile, "display_name" | "phone" | "address">>): Promise<void> => {
      if (!options.session) throw new Error("Não autenticado.");
      const updated = await fetchJson<BuyerProfile>(`${base}/buyer/me/profile`, {
        method: "PATCH",
        headers: buyerHeaders(options.session),
        credentials: "include",
        body: JSON.stringify(data)
      });
      setProfile(updated);
    },
    [base, options.session]
  );

  const saveAgent = useCallback(
    async (data: Partial<BuyerAgentProfile>): Promise<void> => {
      if (!options.session) throw new Error("Não autenticado.");
      const updated = await fetchJson<BuyerAgentProfile>(`${base}/buyer/me/agent`, {
        method: "PUT",
        headers: buyerHeaders(options.session),
        credentials: "include",
        body: JSON.stringify(data)
      });
      setAgent(updated);
    },
    [base, options.session]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      if (!options.session) throw new Error("Não autenticado.");
      await fetchJson<{ success: boolean }>(`${base}/buyer/me/password`, {
        method: "PATCH",
        headers: buyerHeaders(options.session),
        credentials: "include",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
      });
    },
    [base, options.session]
  );

  useEffect(() => {
    if (!options.enabled || !options.session) return;
    void refresh();
  }, [options.enabled, options.session, refresh]);

  return {
    profile,
    summary,
    purchases,
    agent,
    loading,
    error,
    hasMorePurchases,
    refresh,
    loadMorePurchases,
    saveProfile,
    saveAgent,
    changePassword
  };
}
