import type { SupportCaseDetail, SupportCaseSummary, SupportOrder, ReturnRequestResult } from "@zyon/shared-types";
import { apiCall, API_BASE } from "./http";

export type { SupportCaseDetail, SupportCaseSummary, SupportOrder, ReturnRequestResult };
export const SUPPORT_CHANGED_EVENT = "zyon:support-changed";
export function supportChanged() { window.dispatchEvent(new Event(SUPPORT_CHANGED_EVENT)); }
export function rememberSupportTicket(ticketId: string) {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(ticketId)) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("supportTicket") === ticketId) return;
  url.searchParams.set("supportTicket", ticketId);
  window.history.replaceState(window.history.state, "", url);
}
export function evidenceUrl(path: string) { return path.startsWith("/support/") ? `${API_BASE}${path}` : path; }
export function caseLabel(item: SupportCaseSummary) {
  const statuses: Record<string,string> = { REQUESTED: "Aguardando a loja", LABEL_GENERATED: "Envio autorizado", SHIPPED: "Itens em trânsito", RECEIVED: "Itens recebidos", INSPECTED_PASS: "Análise aprovada", INSPECTED_FAIL: "Em análise", REFUND_PROCESSING: "Reembolso em processamento", REFUND_COMPLETED: "Reembolso concluído", EXCHANGE_COMPLETED: "Troca concluída", REJECTED: "Solicitação não aprovada", CANCELLED: "Solicitação cancelada" };
  if (item.returnStatus === "REQUESTED" && item.returnAuthorized) return "Devolução aceita · aguardando código";
  if (item.returnStatus === "REQUESTED" && item.status === "in_progress") return "Em análise pela loja";
  return item.returnStatus ? statuses[item.returnStatus] ?? "Em atendimento" : item.active ? item.status === "open" ? "Aguardando a loja" : "Em atendimento" : "Atendimento concluído";
}
export function listSupportCases(merchantId?: string) {
  return apiCall<{ items: SupportCaseSummary[]; unreadCount: number }>(`/buyer/support/tickets${merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : ""}`, { cache: "no-store" });
}
export async function getSupportCase(ticketId: string) {
  let detail = await apiCall<SupportCaseDetail>(`/buyer/support/tickets/${encodeURIComponent(ticketId)}`, { cache: "no-store" });
  let cursor = detail.nextCursor;
  while (cursor) {
    const page = await apiCall<SupportCaseDetail>(`/buyer/support/tickets/${encodeURIComponent(ticketId)}?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
    detail = { ...page, messages: [...detail.messages, ...page.messages] };
    cursor = page.nextCursor;
  }
  return detail;
}
export function readSupportCase(ticketId: string, lastMessageId: string) {
  return apiCall(`/buyer/support/tickets/${encodeURIComponent(ticketId)}/read`, { method: "POST", body: JSON.stringify({ lastMessageId }) });
}
export function sendCaseMessage(ticketId: string, content: string, clientMessageId: string) {
  return apiCall(`/buyer/support/tickets/${encodeURIComponent(ticketId)}/messages`, { method: "POST", body: JSON.stringify({ content, clientMessageId }) });
}
export function openGenericCase(merchantId: string, content: string, clientMessageId: string) {
  return apiCall<{ ticketId: string }>("/buyer/support/tickets", { method: "POST", body: JSON.stringify({ merchantId, content, clientMessageId }) });
}
export function eligibleReturnOrders(merchantId: string) {
  return apiCall<{ items: SupportOrder[] }>(`/buyer/returns/orders?merchantId=${encodeURIComponent(merchantId)}`);
}
export function openReturnCase(payload: { merchantId: string; orderId: string; kind: "refund" | "exchange"; reason: string; notes: string; requestKey: string; items: Array<{ variantId: string; quantity: number }>; images: string[] }) {
  return apiCall<ReturnRequestResult>("/buyer/returns/request", { method: "POST", body: JSON.stringify(payload) });
}
export interface ReturnDraft {
  orderId: string; step: number; kind: "refund" | "exchange"; reason: string; notes: string; requestKey: string; items: Record<string,number>;
}
export const returnDraftApi = {
  get: (merchantId: string) => apiCall<{ data: ReturnDraft | null }>(`/buyer/returns/draft?merchantId=${encodeURIComponent(merchantId)}`),
  save: (merchantId: string, data: ReturnDraft) => apiCall("/buyer/returns/draft", { method: "POST", body: JSON.stringify({ merchantId, data }) }),
  clear: (merchantId: string) => apiCall(`/buyer/returns/draft?merchantId=${encodeURIComponent(merchantId)}`, { method: "DELETE" }),
};
