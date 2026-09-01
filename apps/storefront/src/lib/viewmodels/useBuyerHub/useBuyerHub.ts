"use client";

import { useCallback, useEffect } from "react";
import { getValidBuyer, clearBuyerSession } from "@/lib/buyer-auth";
import * as buyerHub from "@/lib/services/buyer-hub.service";
import { runFetch, useBuyerHubState } from "./state";
import type { BuyerAddress, BuyerPreferences, BuyerProfile, UseBuyerHub } from "./types";

export function useBuyerHub(): UseBuyerHub {
  const s = useBuyerHubState();

  useEffect(() => {
    const buyer = getValidBuyer();
    s.setAuth(buyer);
    if (!buyer) return;

    void runFetch(s.setProfile, buyerHub.fetchProfile);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "zyon_buyer_token" || e.key === "zyon_buyer_session") {
        const next = getValidBuyer();
        s.setAuth(next);
        if (!next) s.resetSections();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const loadProfile = useCallback(async () => {
    await runFetch(s.setProfile, buyerHub.fetchProfile);
  }, []);
  const updateProfile = useCallback(async (patch: Partial<BuyerProfile>) => {
    s.setProfile((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await buyerHub.updateProfile(patch);
      s.setProfile({ data, loading: false, error: null });
    } catch (err: any) {
      s.setProfile((prev) => ({ ...prev, loading: false, error: err?.message || "Erro ao atualizar perfil" }));
      throw err;
    }
  }, []);

  const loadAddresses = useCallback(async () => {
    await runFetch(s.setAddresses, buyerHub.fetchAddresses);
  }, []);

  const createAddress = useCallback(async (input: Omit<BuyerAddress, "id" | "created_at">) => {
    try {
      const created = await buyerHub.createAddress(input);
      s.setAddresses((prev) => ({
        ...prev,
        data: prev.data ? [created, ...prev.data] : [created],
      }));
      void buyerHub
        .fetchAddresses()
        .then((items) => s.setAddresses({ data: items, loading: false, error: null }))
        .catch(() => {});
      return created;
    } catch (err) {
      console.error("[BUYER-HUB] createAddress failed:", err);
      throw err;
    }
  }, []);

  const updateAddress = useCallback(
    async (id: string, input: Omit<BuyerAddress, "id" | "created_at">) => {
      const updated = await buyerHub.updateAddress(id, input);
      s.setAddresses((prev) => ({
        ...prev,
        data: prev.data ? prev.data.map((a) => (a.id === id ? updated : a)) : prev.data,
      }));
      return updated;
    },
    [],
  );

  const deleteAddress = useCallback(async (id: string) => {
    await buyerHub.deleteAddress(id);
    s.setAddresses((prev) => ({
      ...prev,
      data: prev.data ? prev.data.filter((a) => a.id !== id) : prev.data,
    }));
  }, []);

  const loadPurchases = useCallback(async (reset = true) => {
    if (reset) {
      s.purchasesRef.current = [];
      s.setPurchasesCursor(null);
      s.setPurchasesHasMore(false);
    }
    s.setPurchases((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const cursor = reset ? "" : s.purchasesCursor ?? "";
      const data = await buyerHub.fetchPurchases(cursor);
      const merged = reset ? data.items : [...s.purchasesRef.current, ...data.items];
      s.purchasesRef.current = merged;
      s.setPurchases({ data: merged, loading: false, error: null });
      s.setPurchasesCursor(data.next_cursor);
      s.setPurchasesHasMore(Boolean(data.next_cursor));
    } catch (err: any) {
      s.setPurchases((prev) => ({ ...prev, loading: false, error: err?.message || "Erro ao carregar pedidos" }));
    }
  }, [s.purchasesCursor]);

  const loadMorePurchases = useCallback(async () => {
    if (!s.purchasesHasMore || s.purchases.loading) return;
    await loadPurchases(false);
  }, [s.purchasesHasMore, s.purchases.loading, loadPurchases]);

  const loadTracking = useCallback(async () => {
    s.setTracking((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const filtered = await buyerHub.fetchTracking();
      s.setTracking({ data: filtered, loading: false, error: null });
    } catch (err: any) {
      s.setTracking({ s: false, loading: false, error: err?.message || "Erro ao carregar rastreamento" } as any);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    await runFetch(s.setConversations, buyerHub.fetchConversations);
  }, []);

  const rateMessage = useCallback(
    async (conversationId: string, messageId: string, rating: "up" | "down") => {
      await buyerHub.rateMessage(conversationId, messageId, rating);
      s.setConversations((prev) => ({
        ...prev,
        data: prev.data
          ? prev.data.map((c) =>
              c.id !== conversationId
                ? c
                : {
                    ...c,
                    messages: c.messages.map((m) => (m.id === messageId ? { ...m, rating } : m)),
                  },
            )
          : prev.data,
      }));
    },
    [],
  );

  const loadPreferences = useCallback(async () => {
    await runFetch(s.setPreferences, buyerHub.fetchPreferences);
  }, []);

  const updatePreferences = useCallback(async (patch: Partial<BuyerPreferences>) => {
    s.setPreferences((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await buyerHub.updatePreferences(patch);
      s.setPreferences({ data, loading: false, error: null });
    } catch (err: any) {
      s.setPreferences((prev) => ({ ...prev, loading: false, error: err?.message || "Erro ao salvar preferências" }));
      throw err;
    }
  }, []);

  const loadLoyalty = useCallback(async () => {
    await runFetch(s.setLoyalty, buyerHub.fetchLoyalty);
  }, []);
  const loadBenefits = useCallback(async () => {
    await runFetch(s.setBenefits, buyerHub.fetchBenefits);
  }, []);
  const loadDiscountRules = useCallback(async (merchantSlug: string) => {
    await runFetch(s.setDiscountRules, () => buyerHub.fetchDiscountRules(merchantSlug));
  }, []);
  const loadReviews = useCallback(async () => {
    await runFetch(s.setReviews, buyerHub.fetchReviews);
  }, []);
  const loadIntentProfile = useCallback(async () => {
    await runFetch(s.setIntentProfile, buyerHub.fetchIntentProfile);
  }, []);

  const exportData = useCallback(async () => {
    const blob = await buyerHub.exportData();
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
    const data = await buyerHub.deleteAccount();
    clearBuyerSession();
    s.setAuth(null);
    s.resetSections();
    return data;
  }, []);

  useEffect(() => {
    if (!s.auth) return;
    switch (s.activeTab) {
      case "profile":
        if (!s.profile.data && !s.profile.loading) void loadProfile();
        if (!s.addresses.data && !s.addresses.loading) void loadAddresses();
        break;
      case "orders":
        if (!s.purchases.data && !s.purchases.loading) void loadPurchases(true);
        if (!s.summary.data && !s.summary.loading) void runFetch(s.setSummary, buyerHub.fetchSummary);
        break;
      case "tracking":
        if (!s.tracking.data && !s.tracking.loading) void loadTracking();
        break;
      case "conversations":
        if (!s.conversations.data && !s.conversations.loading) void loadConversations();
        break;
      case "preferences":
        if (!s.preferences.data && !s.preferences.loading) void runFetch(s.setPreferences, buyerHub.fetchPreferences);
        if (!s.intentProfile.data && !s.intentProfile.loading) void runFetch(s.setIntentProfile, buyerHub.fetchIntentProfile);
        break;
      case "loyalty":
        if (!s.loyalty.data && !s.loyalty.loading) void runFetch(s.setLoyalty, buyerHub.fetchLoyalty);
        if (!s.benefits.data && !s.benefits.loading) void loadBenefits();
        if (!s.summary.data && !s.summary.loading) void runFetch(s.setSummary, buyerHub.fetchSummary);
        break;
      case "settings":
        if (!s.intentProfile.data && !s.intentProfile.loading) void runFetch(s.setIntentProfile, buyerHub.fetchIntentProfile);
        if (!s.reviews.data && !s.reviews.loading) void loadReviews();
        break;
    }
  }, [s.activeTab, s.auth]);

  const refresh = useCallback(async () => {
    if (!s.auth) return;
    switch (s.activeTab) {
      case "profile":
        await loadProfile();
        break;
      case "orders":
        await loadPurchases(true);
        await runFetch(s.setSummary, buyerHub.fetchSummary);
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
        await loadBenefits();
        await runFetch(s.setSummary, buyerHub.fetchSummary);
        break;
      case "settings":
        await loadIntentProfile();
        await loadReviews();
        break;
    }
  }, [s.auth, s.activeTab]);

  const signOut = useCallback(() => {
    clearBuyerSession();
    s.setAuth(null);
    s.resetSections();
    s.setActiveTab("profile");
  }, []);
  return {
    auth: s.auth,
    signOut,
    activeTab: s.activeTab,
    setActiveTab: s.setActiveTab,
    profile: s.profile,
    loadProfile,
    updateProfile,
    addresses: s.addresses,
    loadAddresses,
    createAddress,
    updateAddress,
    deleteAddress,
    purchases: s.purchases,
    purchasesCursor: s.purchasesCursor,
    purchasesHasMore: s.purchasesHasMore,
    loadPurchases,
    loadMorePurchases,
    summary: s.summary,
    tracking: s.tracking,
    loadTracking,
    conversations: s.conversations,
    loadConversations,
    rateMessage,
    preferences: s.preferences,
    loadPreferences,
    updatePreferences,
    loyalty: s.loyalty,
    loadLoyalty,
    benefits: s.benefits,
    loadBenefits,
    discountRules: s.discountRules,
    loadDiscountRules,
    reviews: s.reviews,
    loadReviews,
    intentProfile: s.intentProfile,
    loadIntentProfile,
    exportData,
    deleteAccount,
    refresh,
  };
}
