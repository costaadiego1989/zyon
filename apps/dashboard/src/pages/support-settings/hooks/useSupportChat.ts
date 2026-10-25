import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketMessage } from "../../../hooks/useSupportSocket.js";
import { reportError } from "../../../hooks/useErrorReporter.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

export function useSupportChat(api: DashboardApi, ticketId: string) {
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    void loadMessages();
    return () => { request.current += 1; };
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMessages() {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTicketMessages(ticketId);
      if (current === request.current) setMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      reportError({ source: "useSupportChat.loadMessages", error: e });
      if (current === request.current) setError("Não foi possível carregar o histórico da conversa.");
    } finally {
      if (current === request.current) setLoading(false);
    }
  }

  const addMessage = useCallback((msg: TicketMessage) => {
    setMessages((prev) => prev.some(message => message.id === msg.id) ? prev : [...prev, msg]);
  }, []);

  const addOptimisticMerchantMessage = useCallback((content: string) => {
    const msg: TicketMessage = {
      id: `temp_${Date.now()}`,
      ticketId,
      senderType: "merchant",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
  }, [ticketId]);

  return {
    messages,
    loading,
    error,
    addMessage,
    addOptimisticMerchantMessage,
    reload: loadMessages,
  };
}
