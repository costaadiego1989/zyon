"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getValidBuyer, clearBuyerSession, type ValidBuyer } from "@/lib/buyer-auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

// ─── Shared Types ──────────────────────────────────────────────────────────

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
  discount_sensitivity?: number | null;
  last_purchase_at?: string | null;
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

// ─── Tab + State Shape ─────────────────────────────────────────────────────

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_SECTION: SectionState<any> = { data: null, loading: false, error: null };

// ─── Auth helper ───────────────────────────────────────────────────────────

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
      msg = j?.message || j?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  // 204 / empty
  if (res.status === 204) return undefined as unknown as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

// ─── Public hook ───────────────────────────────────────────────────────────

export interface UseBuyerHub {
  // Auth
  auth: ValidBuyer | null;
  signOut: () => void;

  // Tab
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Profile
  profile: SectionState<BuyerProfile>;
  loadProfile: () => Promise<void>;
  updateProfile: (patch: Partial<BuyerProfile>) => Promise<void>;

  // Addresses
  addresses: SectionState<BuyerAddress[]>;
  loadAddresses: () => Promise<void>;
  createAddress: (input: Omit<BuyerAddress, "id" | "created_at">) => Promise<BuyerAddress>;
  updateAddress: (id: string, input: Omit<BuyerAddress, "id" | "created_at">) => Promise<BuyerAddress>;
  deleteAddress: (id: string) => Promise<void>;

  // Purchases
  purchases: SectionState<BuyerPurchase[]>;
  purchasesCursor: string | null;
  purchasesHasMore: boolean;
  loadPurchases: (reset?: boolean) => Promise<void>;
  loadMorePurchases: () => Promise<void>;
  summary: SectionState<BuyerSummary>;

  // Tracking (filtered from purchases)
  tracking: SectionState<BuyerPurchase[]>;
  loadTracking: () => Promise<void>;

  // Conversations
  conversations: SectionState<BuyerConversation[]>;
  loadConversations: () => Promise<void>;
  rateMessage: (conversationId: string, messageId: string, rating: "up" | "down") => Promise<void>;

  // Preferences
  preferences: SectionState<BuyerPreferences>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (patch: Partial<BuyerPreferences>) => Promise<void>;

  // Loyalty
  loyalty: SectionState<BuyerLoyalty>;
  loadLoyalty: () => Promise<void>;

  // Reviews
  reviews: SectionState<BuyerReview[]>;
  loadReviews: () => Promise<void>;

  // Settings
  intentProfile: SectionState<BuyerIntentProfile>;
  loadIntentProfile: () => Promise<void>;
  exportData: () => Promise<void>;
  deleteAccount: () => Promise<{ deleted: boolean; anonymized_purchases: number } | null>;

  // Refresh everything
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
  const [reviews, setReviews] = useState<SectionState<BuyerReview[]>>(EMPTY_SECTION);
  const [intentProfile, setIntentProfile] = useState<SectionState<BuyerIntentProfile>>(EMPTY_SECTION);

  // ─── Auth bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    const buyer = getValidBuyer();
    setAuth(buyer);
    if (!buyer) return;

    // Auto-load profile on mount (small, always useful for header).
    void runFetch(setProfile, "/buyer/me");

    // Sync across tabs/windows.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "zyon_buyer_token" || e.key === "zyon_buyer_session") {
        const next = getValidBuyer();
        setAuth(next);
        if (!next) {
          // Hard reset sections on logout.
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
          setReviews(EMPTY_SECTION);
          setIntentProfile(EMPTY_SECTION);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ─── Lazy per-tab loaders ─────────────────────────────────────────────
  useEffect(() => {
    if (!auth) return;
    switch (activeTab) {
      case "profile":
        if (!profile.data && !profile.loading) void loadProfile();
        break;
      case "orders":
        if (!purchases.data && !purchases.loading) void loadPurchases(true);
        if (!summary.data && !summary.loading) void runFetch(setSummary, "/buyer/me/summary");
        break;
      case "tracking":
        if (!tracking.data && !tracking.loading) void loadTracking();
        break;
      case "conversations":
        if (!conversations.data && !conversations.loading) void runFetch(setConversations, "/buyer/me/conversations");
        break;
      case "preferences":
        if (!preferences.data && !preferences.loading) void runFetch(setPreferences, "/buyer/me/preferences");
        break;
      case "loyalty":
        if (!loyalty.data && !loyalty.loading) void runFetch(setLoyalty, "/buyer/me/loyalty");
        break;
      case "settings":
        if (!intentProfile.data && !intentProfile.loading) void runFetch(setIntentProfile, "/buyer/me/intent-profile");
        if (!reviews.data && !reviews.loading) void runFetch(setReviews, "/buyer/me/reviews");
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, auth]);

  // ─── Generic fetch helper ─────────────────────────────────────────────
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

  // ─── Profile ──────────────────────────────────────────────────────────
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

  // ─── Addresses ────────────────────────────────────────────────────────
  const loadAddresses = useCallback(async () => {
    await runFetch<{ items: BuyerAddress[] }>(setAddresses as any, "/buyer/me/addresses")
      .then((res) => {
        if (res) setAddresses({ data: res.items, loading: false, error: null });
      });
  }, []);

  const createAddress = useCallback(async (input: Omit<BuyerAddress, "id" | "created_at">) => {
    const created = await apiCall<BuyerAddress>("/buyer/me/addresses", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setAddresses((s) => ({
      ...s,
      data: s.data ? [created, ...s.data] : [created],
    }));
    return created;
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

  // ─── Purchases (cursor pagination) ────────────────────────────────────
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

  // ─── Tracking (derived from purchases with tracking_code) ─────────────
  const loadTracking = useCallback(async () => {
    setTracking((s) => ({ ...s, loading: true, error: null }));
    try {
      // Pull up to 50 most recent and filter where tracking_code exists.
      const data = await apiCall<PurchasePage>("/buyer/me/purchases?limit=50");
      const filtered = data.items.filter((p) => Boolean(p.tracking_code));
      setTracking({ data: filtered, loading: false, error: null });
    } catch (err: any) {
      setTracking({ s: false, loading: false, error: err?.message || "Erro ao carregar rastreamento" } as any);
    }
  }, []);

  // ─── Conversations ────────────────────────────────────────────────────
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
      // Patch local cache so UI reflects the vote immediately.
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

  // ─── Preferences ──────────────────────────────────────────────────────
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

  // ─── Loyalty ──────────────────────────────────────────────────────────
  const loadLoyalty = useCallback(async () => {
    await runFetch(setLoyalty, "/buyer/me/loyalty");
  }, []);

  // ─── Reviews ──────────────────────────────────────────────────────────
  const loadReviews = useCallback(async () => {
    await runFetch<{ items: BuyerReview[] }>(setReviews as any, "/buyer/me/reviews")
      .then((res) => {
        if (res) setReviews({ data: res.items, loading: false, error: null });
      });
  }, []);

  // ─── Settings: export + delete ────────────────────────────────────────
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
      // Reset sections.
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

    reviews,
    loadReviews,

    intentProfile,
    loadIntentProfile,
    exportData,
    deleteAccount,

    refresh,
  };
}
