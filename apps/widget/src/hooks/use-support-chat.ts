import { useCallback, useState } from "react";

export interface SupportMessage {
  role: "user" | "agent";
  text: string;
}

interface UseSupportChatOptions {
  apiBaseUrl: string;
  merchantId: string;
  sessionId?: string;
  embedToken?: string;
}

export interface SupportChatState {
  messages: SupportMessage[];
  loading: boolean;
  error: string | null;
  latestTicketId: string | null;
  handoffPending: boolean;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

function smartFallback(text: string): string {
  const t = text.toLowerCase();
  if (/(frete|entrega|prazo|rastreio|rastreamento)/.test(t))
    return "Para dúvidas sobre frete e prazo, consulte o rastreamento no e-mail de confirmação do pedido.";
  if (/(troca|devolu|reembolso|cancelamento|cancelar)/.test(t))
    return "Trocas e devoluções podem ser solicitadas em até 7 dias pelo e-mail de atendimento da loja.";
  if (/(pagamento|cartão|cartao|pix|boleto|recusado|cobrado)/.test(t))
    return "Para problemas com pagamento, verifique seu extrato ou entre em contato com o banco emissor.";
  if (/(produto|item|estoque|disponível|disponivel|esgotado)/.test(t))
    return "Para informações sobre disponibilidade de produto, acesse o site da loja.";
  if (/(cupom|desconto|promoção|promocao|oferta)/.test(t))
    return "Cupons são aplicados durante o checkout. Verifique se o código está correto e dentro do prazo de validade.";
  if (/(conta|senha|login|acesso|cadastro)/.test(t))
    return "Para problemas de acesso à conta, use a opção 'Esqueci minha senha' na página de login.";
  return "Entendo sua dúvida. Nossa equipe responde em até 24h — envie um e-mail para o suporte da loja.";
}

export function useSupportChat({ apiBaseUrl, sessionId, embedToken }: UseSupportChatOptions): SupportChatState {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestTicketId, setLatestTicketId] = useState<string | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setMessages((prev) => [...prev, { role: "user", text: text.trim() }]);
      setLoading(true);
      setError(null);

      try {
        const base = apiBaseUrl.replace(/\/$/, "");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        // /support/chat derives the merchant from the verified embed token
        // (ADR-0003); merchant_id is no longer accepted in the body.
        if (embedToken?.trim()) headers["x-aacp-embed-token"] = embedToken.trim();
        const res = await fetch(`${base}/support/chat`, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ message: text.trim(), session_id: sessionId }),
        });
        const fallback = smartFallback(text);
        if (!res.ok) {
          setMessages((prev) => [...prev, { role: "agent", text: fallback }]);
          setError("Falha ao contatar o suporte.");
          return;
        }
        const data = (await res.json()) as {
          reply?: string;
          handoff?: { ticketId?: string; status?: string };
        };
        const reply = data.reply?.trim() ? data.reply : fallback;
        if (data.handoff?.ticketId) {
          setLatestTicketId(data.handoff.ticketId);
          setHandoffPending(true);
        }
        setMessages((prev) => [...prev, { role: "agent", text: reply }]);
      } catch {
        setMessages((prev) => [...prev, { role: "agent", text: smartFallback(text) }]);
        setError("Falha ao contatar o suporte.");
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, sessionId, embedToken, loading]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setLatestTicketId(null);
    setHandoffPending(false);
  }, []);

  return { messages, loading, error, latestTicketId, handoffPending, send, reset };
}
