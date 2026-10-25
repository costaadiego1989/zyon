export interface FaqItem {
  icon?: string;
  question: string;
  answer: string;
}

export interface SupportChatRequest {
  merchantId: string;
  message: string;
  sessionId: string;
}

export interface SupportChatResponse {
  reply: string | null;
  ticketId: string | null;
}

export async function fetchPublicFaq(
  apiBaseUrl: string,
  merchantId: string
): Promise<FaqItem[]> {
  const res = await fetch(
    `${apiBaseUrl}/support/faq/public?merchantId=${encodeURIComponent(merchantId)}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.faqItems) ? data.faqItems : [];
}

export async function sendSupportChat(
  apiBaseUrl: string,
  req: SupportChatRequest
): Promise<SupportChatResponse | null> {
  const res = await fetch(`${apiBaseUrl}/support/chat/public`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      merchant_id: req.merchantId,
      message: req.message,
      session_id: req.sessionId,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    reply: data.reply || data.message || data.response || null,
    ticketId: data.handoff?.ticketId || null,
  };
}
