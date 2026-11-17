import type { CashbackPage, CashbackTransaction, CashbackWalletView } from "@zyon/shared-types";
import { apiCall } from "./http";

export async function fetchCashbackWallet(merchantId: string, signal?: AbortSignal): Promise<CashbackWalletView> {
  const wallet = await apiCall<CashbackWalletView>(`/buyer/me/cashback?merchant_id=${encodeURIComponent(merchantId)}`, { signal });
  if (wallet.merchantId !== merchantId || wallet.currency !== "BRL") throw new Error("cashback_wallet_scope_mismatch");
  return wallet;
}

export function fetchCashbackTransactions(merchantId: string, page = 1, signal?: AbortSignal): Promise<CashbackPage<CashbackTransaction>> {
  const query = new URLSearchParams({ merchant_id: merchantId, page: String(page), pageSize: "10" });
  return apiCall<CashbackPage<CashbackTransaction>>(`/buyer/me/cashback/transactions?${query}`, { signal });
}

export interface BuyerWhatsAppLink { linked: boolean; phone: string | null; }
export interface BuyerWhatsAppInboundChallenge { token: string; url: string; expiresAt: string; phone: string; }
export interface BuyerWhatsAppInboundStatus extends BuyerWhatsAppLink { status: "pending" | "confirmed" | "cancelled" | "expired"; }

export function requestBuyerWhatsAppInboundLink(phone: string, merchantId: string): Promise<BuyerWhatsAppInboundChallenge> {
  return apiCall("/buyer/me/channels/whatsapp/inbound", { method: "POST", body: JSON.stringify({ phone, merchantId }) });
}

export function fetchBuyerWhatsAppInboundStatus(token: string, signal?: AbortSignal): Promise<BuyerWhatsAppInboundStatus> {
  return apiCall("/buyer/me/channels/whatsapp/inbound/status", { method: "POST", body: JSON.stringify({ token }), signal });
}

export function fetchBuyerWhatsAppLink(signal?: AbortSignal): Promise<BuyerWhatsAppLink> {
  return apiCall<BuyerWhatsAppLink>("/buyer/me/channels/whatsapp", { signal });
}

export function requestBuyerWhatsAppLinkCode(phone: string, merchantId: string): Promise<{ sent: true; delivered_to: string }> {
  return apiCall("/buyer/me/channels/whatsapp/code", { method: "POST", body: JSON.stringify({ phone, merchantId }) });
}

export function verifyBuyerWhatsAppLink(phone: string, code: string, merchantId: string): Promise<BuyerWhatsAppLink> {
  return apiCall<BuyerWhatsAppLink>("/buyer/me/channels/whatsapp/verify", { method: "POST", body: JSON.stringify({ phone, code, merchantId }) });
}
