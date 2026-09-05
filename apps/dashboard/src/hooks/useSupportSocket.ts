import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: "buyer" | "merchant";
  content: string;
  createdAt: string;
}

interface NewTicketEvent {
  id: string;
  buyerMessage: string;
  sessionId?: string;
}

export function useSupportSocket(apiBaseUrl: string, merchantId: string | undefined, agentName?: string) {
  const socketRef = useRef<Socket | null>(null);
  const joinedTicketsRef = useRef(new Set<string>());
  const [connected, setConnected] = useState(false);
  const [newTickets, setNewTickets] = useState<NewTicketEvent[]>([]);

  useEffect(() => {
    if (!merchantId) return;

    const base = apiBaseUrl.replace(/\/+$/, "");
    const socket = io(`${base}/support`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("authenticated", () => {
      setConnected(true);
      socket.emit("join_merchant", { merchantId });
      for (const ticketId of joinedTicketsRef.current) socket.emit("join_ticket", { ticketId });
    });

    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("error", () => setConnected(false));

    socket.on("new_ticket", (ticket: NewTicketEvent) => {
      setNewTickets((prev) => [ticket, ...prev]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      joinedTicketsRef.current.clear();
    };
  }, [apiBaseUrl, merchantId]);

  const joinTicket = useCallback((ticketId: string) => {
    joinedTicketsRef.current.add(ticketId);
    socketRef.current?.emit("join_ticket", { ticketId, agentName });
  }, [agentName]);

  const leaveTicket = useCallback((ticketId: string) => {
    joinedTicketsRef.current.delete(ticketId);
    socketRef.current?.emit("leave_ticket", { ticketId });
  }, []);

  const sendMessage = useCallback(
    (ticketId: string, content: string) => {
      if (!merchantId) return;
      socketRef.current?.emit("send_message", { ticketId, merchantId, content, senderName: agentName });
    },
    [merchantId, agentName],
  );

  const onNewMessage = useCallback(
    (handler: (msg: TicketMessage) => void) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on("new_message", handler);
      return () => { socket.off("new_message", handler); };
    },
    [],
  );

  const clearNewTickets = useCallback(() => setNewTickets([]), []);

  return {
    connected,
    newTickets,
    clearNewTickets,
    joinTicket,
    leaveTicket,
    sendMessage,
    onNewMessage,
  };
}
