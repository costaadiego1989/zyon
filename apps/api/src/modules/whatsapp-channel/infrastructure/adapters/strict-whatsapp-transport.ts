import type { StrictWhatsAppResult } from "../../domain/ports/whatsapp-sender.port.js";
export async function strictWhatsAppTransport(provider: "meta" | "twilio", url: string, init: RequestInit): Promise<StrictWhatsAppResult> {
  try {
    const response = await fetch(url, { ...init, method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return response.status >= 400 && response.status < 500 && ![408, 409].includes(response.status) ? { status: "failed", messageId: "", acceptance: "not_accepted" } : { status: "uncertain", messageId: "" };
    const value = await response.json() as { sid?: string; messages?: { id?: string }[] };
    const messageId = provider === "meta" ? value.messages?.[0]?.id : value.sid;
    return typeof messageId === "string" && messageId.trim() ? { status: "sent", messageId } : { status: "uncertain", messageId: "" };
  } catch { return { status: "uncertain", messageId: "" }; }
}
