import { API_BASE, apiCall, getToken } from "@/lib/services/http";
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
  BuyerBenefits,
  DiscountRule,
  PurchasePage,
} from "@/lib/viewmodels/useBuyerHub/types";

export function fetchProfile(): Promise<BuyerProfile> {
  return apiCall<BuyerProfile>("/buyer/me");
}

export function updateProfile(patch: Partial<BuyerProfile>): Promise<BuyerProfile> {
  return apiCall<BuyerProfile>("/buyer/me/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function fetchAddresses(): Promise<BuyerAddress[]> {
  const res = await apiCall<{ items: BuyerAddress[] }>("/buyer/me/addresses");
  return res.items;
}

export function createAddress(
  input: Omit<BuyerAddress, "id" | "created_at">,
): Promise<BuyerAddress> {
  return apiCall<BuyerAddress>("/buyer/me/addresses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAddress(
  id: string,
  input: Omit<BuyerAddress, "id" | "created_at">,
): Promise<BuyerAddress> {
  return apiCall<BuyerAddress>(`/buyer/me/addresses/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteAddress(id: string): Promise<{ success: boolean }> {
  return apiCall<{ success: boolean }>(`/buyer/me/addresses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchPurchases(cursor: string, limit = 10, merchantId?: string): Promise<PurchasePage> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  if (merchantId) query.set("merchant_id", merchantId);
  return apiCall<PurchasePage>(`/buyer/me/purchases?${query}`, { cache: "no-store" });
}

export async function fetchTracking(merchantId?: string): Promise<BuyerPurchase[]> {
  const purchases: BuyerPurchase[] = [];
  const seenCursors = new Set<string>();
  const buyerToken = getToken();
  let cursor = "";

  do {
    if (!buyerToken || getToken() !== buyerToken) throw new Error("Sessão expirada. Faça login novamente.");
    const page = await fetchPurchases(cursor, 100, merchantId);
    if (getToken() !== buyerToken) throw new Error("Sessão expirada. Faça login novamente.");
    purchases.push(...page.items);

    const nextCursor = page.next_cursor;
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      throw new Error("Não foi possível carregar todo o rastreamento. Tente novamente.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return purchases.filter(
    (purchase) => purchase.tracking_status !== "cancelled" && purchase.tracking_status !== "cancelado",
  );
}

export function fetchSummary(): Promise<BuyerSummary> {
  return apiCall<BuyerSummary>("/buyer/me/summary");
}

export async function fetchConversations(merchantId?: string): Promise<BuyerConversation[]> {
  const query = merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : "";
  const res = await apiCall<{ items: BuyerConversation[] }>(`/buyer/me/conversations${query}`, { cache: "no-store" });
  return res.items;
}

export function fetchConversation(id: string, merchantId: string): Promise<BuyerConversation> {
  return apiCall<BuyerConversation>(`/buyer/me/conversations/${encodeURIComponent(id)}?merchant_id=${encodeURIComponent(merchantId)}`, { cache: "no-store" });
}

export function rateMessage(
  conversationId: string,
  messageId: string,
  rating: "up" | "down",
  merchantId?: string,
): Promise<{ success: boolean }> {
  const query = merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : "";
  return apiCall<{ success: boolean }>(
    `/buyer/me/conversations/${encodeURIComponent(conversationId)}/rate${query}`,
    { method: "POST", body: JSON.stringify({ message_id: messageId, rating }) },
  );
}

export function fetchPreferences(): Promise<BuyerPreferences> {
  return apiCall<BuyerPreferences>("/buyer/me/preferences");
}

export function updatePreferences(
  patch: Partial<BuyerPreferences>,
): Promise<BuyerPreferences> {
  return apiCall<BuyerPreferences>("/buyer/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function fetchLoyalty(): Promise<BuyerLoyalty> {
  return apiCall<BuyerLoyalty>("/buyer/me/loyalty");
}

export function fetchBenefits(merchantId?: string): Promise<BuyerBenefits> {
  const query = merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : "";
  return apiCall<BuyerBenefits>(`/buyer/me/benefits${query}`, { cache: "no-store" });
}

export async function fetchDiscountRules(merchantSlug: string): Promise<DiscountRule[]> {
  const res = await apiCall<{ items: DiscountRule[] }>(
    `/storefront/${encodeURIComponent(merchantSlug)}/coupons`,
  );
  return res.items;
}

export async function fetchReviews(): Promise<BuyerReview[]> {
  const res = await apiCall<{ items: BuyerReview[] }>("/buyer/me/reviews");
  return res.items;
}

export function fetchIntentProfile(): Promise<BuyerIntentProfile> {
  return apiCall<BuyerIntentProfile>("/buyer/me/intent-profile");
}

export async function exportData(): Promise<Blob> {
  const token = getToken();
  if (!token) throw new Error("Sessão expirada. Faça login novamente.");
  const res = await fetch(`${API_BASE}/buyer/me/export`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Erro ${res.status} ao exportar dados`);
  return res.blob();
}

export function deleteAccount(): Promise<{
  deleted: boolean;
  anonymized_purchases: number;
}> {
  return apiCall<{ deleted: boolean; anonymized_purchases: number }>("/buyer/me/account", {
    method: "DELETE",
  });
}
