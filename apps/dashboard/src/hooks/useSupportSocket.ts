import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { SupportMessageMetadata } from "@zyon/shared-types";

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: "buyer" | "merchant";
  content: string;
  metadata?: SupportMessageMetadata | null;
  createdAt: string;
}

interface NewTicketEvent {
  id: string;
  buyerMessage: string;
  sessionId?: string;
}

export interface TicketTransferredEvent {
  ticketId: string;
  fromMerchantId: string;
  toMerchantId: string;
  toStoreName: string;
}

export function useSupportSocket(apiBaseUrl: string, merchantId: string | undefined, agentName?: string) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [newTickets, setNewTickets] = useState<NewTicketEvent[]>([]);

  useEffect(() => {
    if (!merchantId) return;

    const base = apiBaseUrl.replace(/\/+$/, "");
    const socket = io(`${base}/support`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_merchant", { merchantId });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("new_ticket", (ticket: NewTicketEvent) => {
      setNewTickets((prev) => [ticket, ...prev]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [apiBaseUrl, merchantId]);

  const joinTicket = useCallback((ticketId: string) => {
    socketRef.current?.emit("join_ticket", { ticketId, agentName });
  }, [agentName]);

  const leaveTicket = useCallback((ticketId: string) => {
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

  const onTicketTransferred = useCallback(
    (handler: (event: TicketTransferredEvent) => void) => {
      const socket = socketRef.current;
      if (!socket) return () => {};
      socket.on("ticket_transferred", handler);
      return () => { socket.off("ticket_transferred", handler); };
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
    onTicketTransferred,
  };
}
