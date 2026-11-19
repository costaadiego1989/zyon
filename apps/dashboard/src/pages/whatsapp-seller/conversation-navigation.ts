import { canConfigureWhatsApp, canUseWhatsAppConversations } from "../../lib/auth/permissions.js";

export type WhatsAppTab = "connection" | "templates" | "orders" | "usage" | "conversations";
export interface WhatsAppRoute { allowed: boolean; tab: WhatsAppTab | null; ticketId: string | null }
const tabs = new Set<WhatsAppTab>(["connection", "templates", "orders", "usage", "conversations"]);
const denied = (): WhatsAppRoute => ({ allowed: false, tab: null, ticketId: null });

/** URL selection is never an authenticated tenant/operator identity. */
export function readWhatsAppRoute(hash: string, role: unknown): WhatsAppRoute {
  if (!canUseWhatsAppConversations(role)) return denied();
  const [page, query = ""] = hash.replace(/^#/, "").split("?", 2);
  if (page !== "whatsapp-seller") return denied();
  const params = new URLSearchParams(query);
  const tab = params.get("tab") ?? (role === "STAFF" ? "conversations" : "connection");
  if (!tabs.has(tab as WhatsAppTab) || (tab !== "conversations" && !canConfigureWhatsApp(role))) return denied();
  return { allowed: true, tab: tab as WhatsAppTab, ticketId: tab === "conversations" ? params.get("ticketId") || null : null };
}

export function whatsAppRouteUrl(tab: WhatsAppTab, ticketId: string | null = null, currentHash = ""): string {
  if (!tabs.has(tab)) throw Error("invalid_whatsapp_tab");
  const [page, query = ""] = currentHash.replace(/^#/, "").split("?", 2);
  const params = new URLSearchParams(page === "whatsapp-seller" ? query : "");
  params.set("tab", tab); params.delete("ticketId");
  const selected = tab === "conversations" && ticketId ? "&ticketId=" + encodeURIComponent(ticketId) : "";
  return "#whatsapp-seller?" + params.toString() + selected;
}
