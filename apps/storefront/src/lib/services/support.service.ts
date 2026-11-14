import { API_BASE } from "./http";

export interface FaqItem {
  id?: string;
  question: string;
  answer: string;
  icon?: string;
}

export interface ChatPayload {
  merchant_id: string;
  message: string;
  session_id: string;
}

export interface ChatResponse {
  reply?: string;
  message?: string;
  response?: string;
  handoff?: {
    ticketId: string;
  };
}

export interface CheckoutTokenResponse {
  embed_session_token?: string;
}

export interface FaqResponse {
  faqItems: FaqItem[];
}

export interface BuyerOrderOption {
  id: string;
  order_id: string;
  merchant_name: string;
  created_at?: string | null;
}

export interface ReturnRequestPayload {
  orderId?: string;
  merchantId: string;
  reason: string;
  title: string;
  description: string;
  items: Array<{ variantId: string; quantity: number; reason?: string }>;
  images: string[];
}

function buyerToken(): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem("zyon_buyer_token") : null;
}

export async function fetchBuyerOrders(
  merchantId: string,
): Promise<BuyerOrderOption[]> {
  try {
    const token = buyerToken();
    if (!token) return [];
    const res = await fetch(
      `${API_BASE}/buyer/me/purchases?merchant_id=${encodeURIComponent(merchantId)}&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) {
      const data = (await res.json()) as { items?: BuyerOrderOption[] };
      return Array.isArray(data.items) ? data.items : [];
    }
  } catch {}
  return [];
}

export async function submitReturnRequest(payload: ReturnRequestPayload): Promise<void> {
  const token = buyerToken();
  const res = await fetch(`${API_BASE}/buyer/returns/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message ?? "Erro ao enviar solicitação");
  }
}

export async function fetchCheckoutToken(
  merchantId: string,
): Promise<string | null> {
  try {
    const res = await fetch("/api/checkout-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        allowed_origin:
          typeof window !== "undefined" ? window.location.origin : undefined,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as CheckoutTokenResponse;
      return data.embed_session_token ?? null;
    }
  } catch {}
  return null;
}

export async function fetchPublicFaq(
  merchantId: string,
): Promise<FaqItem[]> {
  try {
    const res = await fetch(
      `${API_BASE}/support/faq/public?merchantId=${merchantId}`,
    );
    if (res.ok) {
      const data = (await res.json()) as FaqResponse;
      return Array.isArray(data.faqItems) ? data.faqItems : [];
    }
  } catch {}
  return [];
}

export async function sendSupportChat(
  payload: ChatPayload,
): Promise<ChatResponse> {
  try {
    const res = await fetch(`${API_BASE}/support/chat/public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return (await res.json()) as ChatResponse;
    }
  } catch {}
  return {};
}
