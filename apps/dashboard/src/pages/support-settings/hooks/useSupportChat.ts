import { useCallback, useEffect, useState } from "react";
import type { TicketMessage } from "../../../hooks/useSupportSocket.js";
import { reportError } from "../../../hooks/useErrorReporter.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;

export function useSupportChat(api: DashboardApi, ticketId: string) {
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadMessages();
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMessages() {
    setLoading(true);
    try {
      const data = await api.getTicketMessages(ticketId);
      setMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      reportError({ source: "useSupportChat.loadMessages", error: e });
    } finally {
      setLoading(false);
    }
  }

  const addMessage = useCallback((msg: TicketMessage) => {
    setMessages((prev) => [...prev, msg]);
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
    addMessage,
    addOptimisticMerchantMessage,
    reload: loadMessages,
  };
}
