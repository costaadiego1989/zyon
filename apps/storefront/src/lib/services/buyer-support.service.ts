import { apiCall, API_BASE } from "./http";
import { getValidBuyer } from "../buyer-auth";
import { conversationFetch } from "../conversation-access";

export interface BuyerSupportMessage { id: string; ticketId: string; senderType: string; content: string; createdAt: string }
export interface BuyerSupportTicket {
  ticketId: string; merchantId: string; kind: string; status: string; active: boolean; unreadCount: number;
  updatedAt: string; lastMessage: BuyerSupportMessage | null;
}
export interface BuyerSupportDetail extends BuyerSupportTicket { messages: BuyerSupportMessage[]; nextCursor: string | null }

export async function fetchBuyerSupport(merchantId: string, signal?: AbortSignal) {
  return apiCall<{ items: BuyerSupportTicket[]; unreadCount: number }>(`/buyer/support/tickets?merchantId=${encodeURIComponent(merchantId)}`, { signal });
}
export function fetchBuyerSupportDetail(ticketId: string, cursor?: string) {
  return apiCall<BuyerSupportDetail>(`/buyer/support/tickets/${encodeURIComponent(ticketId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
}
export function readBuyerSupport(ticketId: string, lastMessageId: string) {
  return apiCall(`/buyer/support/tickets/${encodeURIComponent(ticketId)}/read`, { method: "POST", body: JSON.stringify({ lastMessageId }) });
}
export function sendBuyerSupport(ticketId: string, content: string, clientMessageId: string) {
  return apiCall<BuyerSupportMessage>(`/buyer/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST", body: JSON.stringify({ content, clientMessageId }),
  });
}
export async function linkBuyerSupportConversation(conversationId: string) {
  const buyer = getValidBuyer();
  if (!buyer) return;
  const response = await conversationFetch(conversationId, `${API_BASE}/storefront/conversations/${encodeURIComponent(conversationId)}/support/buyer`, {
    method: "POST", headers: { "X-Buyer-Authorization": `Bearer ${buyer.token}` },
  });
  if (!response.ok) throw new Error("Não foi possível vincular seu atendimento.");
}
