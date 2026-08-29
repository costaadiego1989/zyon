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

export function fetchPurchases(cursor: string, limit = 10): Promise<PurchasePage> {
  const qs = cursor ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}` : `?limit=${limit}`;
  return apiCall<PurchasePage>(`/buyer/me/purchases${qs}`);
}

export async function fetchTracking(): Promise<BuyerPurchase[]> {
  const data = await apiCall<PurchasePage>("/buyer/me/purchases?limit=50");
  return data.items.filter(
    (p) => p.tracking_status !== "cancelled" && p.tracking_status !== "cancelado",
  );
}

export function fetchSummary(): Promise<BuyerSummary> {
  return apiCall<BuyerSummary>("/buyer/me/summary");
}

export async function fetchConversations(): Promise<BuyerConversation[]> {
  const res = await apiCall<{ items: BuyerConversation[] }>("/buyer/me/conversations");
  return res.items;
}

export function rateMessage(
  conversationId: string,
  messageId: string,
  rating: "up" | "down",
): Promise<{ success: boolean }> {
  return apiCall<{ success: boolean }>(
    `/buyer/me/conversations/${encodeURIComponent(conversationId)}/rate`,
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
