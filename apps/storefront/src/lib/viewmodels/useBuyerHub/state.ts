"use client";

import { useRef, useState } from "react";
import type { ValidBuyer } from "@/lib/buyer-auth";
import type {
  BuyerAddress,
  BuyerConversation,
  BuyerIntentProfile,
  BuyerLoyalty,
  BuyerPreferences,
  BuyerProfile,
  BuyerPurchase,
  BuyerReview,
  BuyerSummary,
  DiscountRule,
  SectionState,
  TabType,
} from "./types";

export const EMPTY_SECTION: SectionState<any> = { data: null, loading: false, error: null };

export function useBuyerHubState() {
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

  function resetSections() {
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

  return {
    auth,
    setAuth,
    activeTab,
    setActiveTab,
    profile,
    setProfile,
    addresses,
    setAddresses,
    purchases,
    setPurchases,
    purchasesCursor,
    setPurchasesCursor,
    purchasesHasMore,
    setPurchasesHasMore,
    purchasesRef,
    summary,
    setSummary,
    tracking,
    setTracking,
    conversations,
    setConversations,
    preferences,
    setPreferences,
    loyalty,
    setLoyalty,
    discountRules,
    setDiscountRules,
    reviews,
    setReviews,
    intentProfile,
    setIntentProfile,
    resetSections,
  };
}

export type BuyerHubState = ReturnType<typeof useBuyerHubState>;

export async function runFetch<T>(
  setter: React.Dispatch<React.SetStateAction<SectionState<T>>>,
  fetcher: () => Promise<T>,
): Promise<T | null> {
  setter((s) => ({ ...s, loading: true, error: null }));
  try {
    const data = await fetcher();
    setter({ data, loading: false, error: null });
    return data;
  } catch (err: any) {
    setter({ data: null, loading: false, error: err?.message || "Erro desconhecido" });
    return null;
  }
}
