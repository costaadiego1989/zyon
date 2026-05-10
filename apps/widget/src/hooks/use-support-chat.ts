import { useCallback, useState } from "react";

export interface SupportMessage {
  role: "user" | "agent";
  text: string;
}

interface UseSupportChatOptions {
  apiBaseUrl: string;
  merchantId: string;
  sessionId?: string;
}

export interface SupportChatState {
  messages: SupportMessage[];
  loading: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
}

const FALLBACK = "Entendo sua dúvida. Para mais detalhes, entre em contato com nosso suporte humano.";

export function useSupportChat({ apiBaseUrl, merchantId, sessionId }: UseSupportChatOptions): SupportChatState {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setMessages((prev) => [...prev, { role: "user", text: text.trim() }]);
      setLoading(true);
      setError(null);

      try {
        const base = apiBaseUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/support/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: text.trim(), merchant_id: merchantId, session_id: sessionId }),
        });
        const data = (await res.json()) as { reply?: string };
        setMessages((prev) => [...prev, { role: "agent", text: data.reply ?? FALLBACK }]);
      } catch {
        setMessages((prev) => [...prev, { role: "agent", text: FALLBACK }]);
        setError("Falha ao contatar o suporte.");
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, merchantId, sessionId, loading]
  );

  return { messages, loading, error, send };
}
