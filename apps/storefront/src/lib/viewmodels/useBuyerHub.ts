"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getValidBuyer, clearBuyerSession, type ValidBuyer } from "@/lib/buyer-auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

export interface BuyerProfile {
  global_user_id: string;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
  address?: BuyerAddress | null;
}

export interface BuyerAddress {
  id: string;
  zip: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  is_default?: boolean;
  created_at?: string;
}

export interface TrackingEvent {
  status: string;
  description?: string;
  location?: string;
  occurred_at: string;
}

export interface PurchaseItem {
  name: string;
  quantity: number;
  unit_price: number;
}

export interface BuyerPurchase {
  id: string;
  order_id: string;
  merchant_name: string;
  tracking_code?: string | null;
  tracking_status?: string | null;
  tracking_url?: string | null;
  carrier?: string | null;
  tracking_events?: TrackingEvent[];
  total: number;
  discount_amount?: number;
  items: PurchaseItem[];
  items_count: number;
  currency: string;
  created_at: string;
  payment_method?: string | null;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "agent" | "assistant" | "system";
  content: string;
  created_at: string;
  rating?: "up" | "down" | null;
}

export interface BuyerConversation {
  id: string;
  session_id: string;
  merchant_id: string;
  started_at: string;
  last_message_at: string;
  messages: ConversationMessage[];
}

export interface BuyerPreferences {
  email_opt_in: boolean;
  sms_opt_in: boolean;
  whatsapp_opt_in: boolean;
  push_notifications_enabled: boolean;
  m2m_negotiation_enabled: boolean;
  language: string;
}

export interface BuyerLoyalty {
  total_orders: number;
  total_spent_cents: number;
  avg_order_value_cents: number;
  top_categories: string[];
  preferred_brands: string[];
  discount_sensitivity?: string | null;
  last_purchase_at?: string | null;
}

export interface DiscountRule {
  id: string;
  code: string;
  discount_type: "percent" | "fixed" | "shipping_free" | "shipping_percent" | "shipping_fixed";
  discount_value: number;
  min_cart_total: number | null;
  max_usages: number | null;
  usages_count: number;
}

export interface BuyerSummary {
  orders_count: number;
  total_spent: number;
  average_ticket: number;
  currency: string;
}

export interface BuyerReview {
  id: string;
  product_name: string;
  rating: number;
  body?: string;
  status: string;
  created_at: string;
}

export interface BuyerIntentProfile {
  has_consent: boolean;
  primary_intent?: string | null;
  category_focus?: string[];
  budget_tier?: string | null;
  conversion_likelihood?: number | null;
}

export interface PurchasePage {
  items: BuyerPurchase[];
  next_cursor: string | null;
}

export type TabType =
  | "profile"
  | "orders"
  | "tracking"
  | "conversations"
  | "preferences"
  | "loyalty"
  | "settings";

export interface SectionState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_SECTION: SectionState<any> = { data: null, loading: false, error: null };

const API_ERROR_MESSAGES: Record<string, string> = {
  email_already_in_use: "Este e-mail já está em uso por outra conta.",
  email_already_registered: "Este e-mail já está cadastrado.",
  cpf_invalid: "CPF inválido. Verifique os dígitos.",
  buyer_account_not_found: "Conta não encontrada.",
};

function friendlyApiError(raw: string): string {
  return API_ERROR_MESSAGES[raw] ?? raw;
}

function getToken(): string | null {
  const buyer: ValidBuyer | null = getValidBuyer();
  return buyer?.token ?? null;
}

async function apiCall<T>(
  path: string,
  init: RequestInit & { authRequired?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const authRequired = init.authRequired !== false;
  if (authRequired) {
    const token = getToken();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const j = await res.json();
      const raw = j?.message || j?.error || j?.detail || msg;
      msg = friendlyApiError(raw);
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export interface UseBuyerHub {
  auth: ValidBuyer | null;
  signOut: () => void;

  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  profile: SectionState<BuyerProfile>;
  loadProfile: () => Promise<void>;
  updateProfile: (patch: Partial<BuyerProfile>) => Promise<void>;

  addresses: SectionState<BuyerAddress[]>;
  loadAddresses: () => Promise<void>;
  createAddress: (input: Omit<BuyerAddress, "id" | "created_at">) => Promise<BuyerAddress>;
  updateAddress: (id: string, input: Omit<BuyerAddress, "id" | "created_at">) => Promise<BuyerAddress>;
  deleteAddress: (id: string) => Promise<void>;

  purchases: SectionState<BuyerPurchase[]>;
  purchasesCursor: string | null;
  purchasesHasMore: boolean;
  loadPurchases: (reset?: boolean) => Promise<void>;
  loadMorePurchases: () => Promise<void>;
  summary: SectionState<BuyerSummary>;

  tracking: SectionState<BuyerPurchase[]>;
  loadTracking: () => Promise<void>;

  conversations: SectionState<BuyerConversation[]>;
  loadConversations: () => Promise<void>;
  rateMessage: (conversationId: string, messageId: string, rating: "up" | "down") => Promise<void>;

  preferences: SectionState<BuyerPreferences>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (patch: Partial<BuyerPreferences>) => Promise<void>;

  loyalty: SectionState<BuyerLoyalty>;
  loadLoyalty: () => Promise<void>;

  discountRules: SectionState<DiscountRule[]>;
  loadDiscountRules: (merchantSlug: string) => Promise<void>;

  reviews: SectionState<BuyerReview[]>;
  loadReviews: () => Promise<void>;

  intentProfile: SectionState<BuyerIntentProfile>;
  loadIntentProfile: () => Promise<void>;
  exportData: () => Promise<void>;
  deleteAccount: () => Promise<{ deleted: boolean; anonymized_purchases: number } | null>;

  refresh: () => Promise<void>;
}

export function useBuyerHub(): UseBuyerHub {
  const [auth, setAuth] = useState<ValidBuyer | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("profile");

  const [profile, setProfile] = useState<SectionState<BuyerProfile>>(EMPTY_SECTION);
  const [addresses, setAddresses] = useState<SectionState<BuyerAddress[]>>(EMPTY_SECTION);

  const [purchases, setPurchases] = useState<SectionState<BuyerPurchase[]>>(EMPTY_SECTION);
  const [purchasesCursor, setPurchasesCursor] = useState<string | null>(null);
  const [purchasesHasMore, setPurchasesHasMore] = useState<boolean>(false);
  const purchasesRef = useRef<BuyerPurchase[]>([]);

  const [summary, setSummary] = useState<SectionState<BuyerSummary>>(EMPTY_SECTION);
  const [tracking, setTracking] = useState<SectionState<BuyerPurchase[]>>(EMPTY_SECTION);

  const [conversations, setConversations] = useState<SectionState<BuyerConversation[]>>(EMPTY_SECTION);
  const [preferences, setPreferences] = useState<SectionState<BuyerPreferences>>(EMPTY_SECTION);
  const [loyalty, setLoyalty] = useState<SectionState<BuyerLoyalty>>(EMPTY_SECTION);
  const [discountRules, setDiscountRules] = useState<SectionState<DiscountRule[]>>(EMPTY_SECTION);
  const [reviews, setReviews] = useState<SectionState<BuyerReview[]>>(EMPTY_SECTION);
  const [intentProfile, setIntentProfile] = useState<SectionState<BuyerIntentProfile>>(EMPTY_SECTION);

  useEffect(() => {
    const buyer = getValidBuyer();
    setAuth(buyer);
    if (!buyer) return;

    void runFetch(setProfile, "/buyer/me");

    const onStorage = (e: StorageEvent) => {
      if (e.key === "zyon_buyer_token" || e.key === "zyon_buyer_session") {
        const next = getValidBuyer();
        setAuth(next);
        if (!next) {
          setProfile(EMPTY_SECTION);
          setAddresses(EMPTY_SECTION);
          setPurchases(EMPTY_SECTION);
          purchasesRef.current = [];
          setPurchasesCursor(null);
          setPurchasesHasMore(false);
          setSummary(EMPTY_SECTION);
          setTracking(EMPTY_SECTION);
          setConversations(EMPTY_SECTION);
          setPreferences(EMPTY_SECTION);
          setLoyalty(EMPTY_SECTION);
          setDiscountRules(EMPTY_SECTION);
          setReviews(EMPTY_SECTION);
          setIntentProfile(EMPTY_SECTION);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!auth) return;
    switch (activeTab) {
      case "profile":
        if (!profile.data && !profile.loading) void loadProfile();
        if (!addresses.data && !addresses.loading) void loadAddresses();
        break;
      case "orders":
        if (!purchases.data && !purchases.loading) void loadPurchases(true);
        if (!summary.data && !summary.loading) void runFetch(setSummary, "/buyer/me/summary");
        break;
      case "tracking":
        if (!tracking.data && !tracking.loading) void loadTracking();
        break;
      case "conversations":
        if (!conversations.data && !conversations.loading) void loadConversations();
        break;
      case "preferences":
        if (!preferences.data && !preferences.loading) void runFetch(setPreferences, "/buyer/me/preferences");
        if (!intentProfile.data && !intentProfile.loading) void runFetch(setIntentProfile, "/buyer/me/intent-profile");
        break;
      case "loyalty":
        if (!loyalty.data && !loyalty.loading) void runFetch(setLoyalty, "/buyer/me/loyalty");
        if (!summary.data && !summary.loading) void runFetch(setSummary, "/buyer/me/summary");
        break;
      case "settings":
        if (!intentProfile.data && !intentProfile.loading) void runFetch(setIntentProfile, "/buyer/me/intent-profile");
        if (!reviews.data && !reviews.loading) void loadReviews();
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, auth]);

  async function runFetch<T>(
    setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
    path: string,
    init?: RequestInit,
  ): Promise<T | null> {
    setter((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiCall<T>(path, init);
      setter({ data, loading: false, error: null });
      return data;
    } catch (err: any) {
      setter({ data: null, loading: false, error: err?.message || "Erro desconhecido" });
      return null;
    }
  }

  const loadProfile = useCallback(async () => {
    await runFetch(setProfile, "/buyer/me");
  }, []);

  const updateProfile = useCallback(async (patch: Partial<BuyerProfile>) => {
    setProfile((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiCall<BuyerProfile>("/buyer/me/profile", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setProfile({ data, loading: false, error: null });
    } catch (err: any) {
      setProfile((s) => ({ ...s, loading: false, error: err?.message || "Erro ao atualizar perfil" }));
      throw err;
    }
  }, []);

  const loadAddresses = useCallback(async () => {
    await runFetch<{ items: BuyerAddress[] }>(setAddresses as any, "/buyer/me/addresses")
      .then((res) => {
        if (res) setAddresses({ data: res.items, loading: false, error: null });
      });
  }, []);

  const createAddress = useCallback(async (input: Omit<BuyerAddress, "id" | "created_at">) => {
    try {
      const created = await apiCall<BuyerAddress>("/buyer/me/addresses", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setAddresses((s) => ({
        ...s,
        data: s.data ? [created, ...s.data] : [created],
      }));
      void apiCall<{ items: BuyerAddress[] }>("/buyer/me/addresses")
        .then((res) => setAddresses({ data: res.items, loading: false, error: null }))
        .catch(() => { /* keep optimistic state */ });
      return created;
    } catch (err) {
      console.error("[BUYER-HUB] createAddress failed:", err);
      throw err;
    }
  }, []);

  const updateAddress = useCallback(
    async (id: string, input: Omit<BuyerAddress, "id" | "created_at">) => {
      const updated = await apiCall<BuyerAddress>(`/buyer/me/addresses/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
      setAddresses((s) => ({
        ...s,
        data: s.data ? s.data.map((a) => (a.id === id ? updated : a)) : s.data,
      }));
      return updated;
    },
    [],
  );

  const deleteAddress = useCallback(async (id: string) => {
    await apiCall<{ success: boolean }>(`/buyer/me/addresses/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setAddresses((s) => ({
      ...s,
      data: s.data ? s.data.filter((a) => a.id !== id) : s.data,
    }));
  }, []);

  const loadPurchases = useCallback(async (reset = true) => {
    if (reset) {
      purchasesRef.current = [];
      setPurchasesCursor(null);
      setPurchasesHasMore(false);
    }
    setPurchases((s) => ({ ...s, loading: true, error: null }));
    try {
      const cursor = reset ? "" : purchasesCursor ?? "";
      const qs = cursor ? `?limit=10&cursor=${encodeURIComponent(cursor)}` : "?limit=10";
      const data = await apiCall<PurchasePage>(`/buyer/me/purchases${qs}`);
      const merged = reset ? data.items : [...purchasesRef.current, ...data.items];
      purchasesRef.current = merged;
      setPurchases({ data: merged, loading: false, error: null });
      setPurchasesCursor(data.next_cursor);
      setPurchasesHasMore(Boolean(data.next_cursor));
    } catch (err: any) {
      setPurchases((s) => ({ ...s, loading: false, error: err?.message || "Erro ao carregar pedidos" }));
    }
  }, [purchasesCursor]);

  const loadMorePurchases = useCallback(async () => {
    if (!purchasesHasMore || purchases.loading) return;
    await loadPurchases(false);
  }, [purchasesHasMore, purchases.loading, loadPurchases]);

  const loadTracking = useCallback(async () => {
    setTracking((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiCall<PurchasePage>("/buyer/me/purchases?limit=50");
      const filtered = data.items.filter(
        (p) => p.tracking_status !== "cancelled" && p.tracking_status !== "cancelado",
      );
      setTracking({ data: filtered, loading: false, error: null });
    } catch (err: any) {
      setTracking({ s: false, loading: false, error: err?.message || "Erro ao carregar rastreamento" } as any);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    await runFetch<{ items: BuyerConversation[] }>(setConversations as any, "/buyer/me/conversations")
      .then((res) => {
        if (res) setConversations({ data: res.items, loading: false, error: null });
      });
  }, []);

  const rateMessage = useCallback(
    async (conversationId: string, messageId: string, rating: "up" | "down") => {
      await apiCall<{ success: boolean }>(
        `/buyer/me/conversations/${encodeURIComponent(conversationId)}/rate`,
        { method: "POST", body: JSON.stringify({ message_id: messageId, rating }) },
      );
      setConversations((s) => ({
        ...s,
        data: s.data
          ? s.data.map((c) =>
              c.id !== conversationId
                ? c
                : {
                    ...c,
                    messages: c.messages.map((m) => (m.id === messageId ? { ...m, rating } : m)),
                  },
            )
          : s.data,
      }));
    },
    [],
  );

  const loadPreferences = useCallback(async () => {
    await runFetch(setPreferences, "/buyer/me/preferences");
  }, []);

  const updatePreferences = useCallback(async (patch: Partial<BuyerPreferences>) => {
    setPreferences((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await apiCall<BuyerPreferences>("/buyer/me/preferences", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setPreferences({ data, loading: false, error: null });
    } catch (err: any) {
      setPreferences((s) => ({ ...s, loading: false, error: err?.message || "Erro ao salvar preferências" }));
      throw err;
    }
  }, []);

  const loadLoyalty = useCallback(async () => {
    await runFetch(setLoyalty, "/buyer/me/loyalty");
  }, []);

  const loadDiscountRules = useCallback(async (merchantSlug: string) => {
    await runFetch<{ items: DiscountRule[] }>(setDiscountRules as any, `/storefront/${encodeURIComponent(merchantSlug)}/coupons`)
      .then((res) => {
        if (res) setDiscountRules({ data: res.items, loading: false, error: null });
      });
  }, []);

  const loadReviews = useCallback(async () => {
    await runFetch<{ items: BuyerReview[] }>(setReviews as any, "/buyer/me/reviews")
      .then((res) => {
        if (res) setReviews({ data: res.items, loading: false, error: null });
      });
  }, []);

  const loadIntentProfile = useCallback(async () => {
    await runFetch(setIntentProfile, "/buyer/me/intent-profile");
  }, []);

  const exportData = useCallback(async () => {
    const token = getToken();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    const res = await fetch(`${API_BASE}/buyer/me/export`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Erro ${res.status} ao exportar dados`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `buyer-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const deleteAccount = useCallback(async () => {
    try {
      const data = await apiCall<{ deleted: boolean; anonymized_purchases: number }>(
        "/buyer/me/account",
        { method: "DELETE" },
      );
      clearBuyerSession();
      setAuth(null);
      setProfile(EMPTY_SECTION);
      setAddresses(EMPTY_SECTION);
      setPurchases(EMPTY_SECTION);
      purchasesRef.current = [];
      setPurchasesCursor(null);
      setPurchasesHasMore(false);
      setSummary(EMPTY_SECTION);
      setTracking(EMPTY_SECTION);
      setConversations(EMPTY_SECTION);
      setPreferences(EMPTY_SECTION);
      setLoyalty(EMPTY_SECTION);
      setDiscountRules(EMPTY_SECTION);
      setReviews(EMPTY_SECTION);
      setIntentProfile(EMPTY_SECTION);
      return data;
    } catch (err) {
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!auth) return;
    switch (activeTab) {
      case "profile":
        await loadProfile();
        break;
      case "orders":
        await loadPurchases(true);
        await runFetch(setSummary, "/buyer/me/summary");
        break;
      case "tracking":
        await loadTracking();
        break;
      case "conversations":
        await loadConversations();
        break;
      case "preferences":
        await loadPreferences();
        break;
      case "loyalty":
        await loadLoyalty();
        await runFetch(setSummary, "/buyer/me/summary");
        break;
      case "settings":
        await loadIntentProfile();
        await loadReviews();
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, activeTab]);

  const signOut = useCallback(() => {
    clearBuyerSession();
    setAuth(null);
    setProfile(EMPTY_SECTION);
    setAddresses(EMPTY_SECTION);
    setPurchases(EMPTY_SECTION);
    purchasesRef.current = [];
    setPurchasesCursor(null);
    setPurchasesHasMore(false);
    setSummary(EMPTY_SECTION);
    setTracking(EMPTY_SECTION);
    setConversations(EMPTY_SECTION);
    setPreferences(EMPTY_SECTION);
    setLoyalty(EMPTY_SECTION);
    setDiscountRules(EMPTY_SECTION);
    setReviews(EMPTY_SECTION);
    setIntentProfile(EMPTY_SECTION);
    setActiveTab("profile");
  }, []);

  return {
    auth,
    signOut,

    activeTab,
    setActiveTab,

    profile,
    loadProfile,
    updateProfile,

    addresses,
    loadAddresses,
    createAddress,
    updateAddress,
    deleteAddress,

    purchases,
    purchasesCursor,
    purchasesHasMore,
    loadPurchases,
    loadMorePurchases,
    summary,

    tracking,
    loadTracking,

    conversations,
    loadConversations,
    rateMessage,

    preferences,
    loadPreferences,
    updatePreferences,

    loyalty,
    loadLoyalty,

    discountRules,
    loadDiscountRules,

    reviews,
    loadReviews,

    intentProfile,
    loadIntentProfile,
    exportData,
    deleteAccount,

    refresh,
  };
}
