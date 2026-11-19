import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { SupportMessageMetadata } from "@zyon/shared-types";

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: "buyer" | "merchant" | "system";
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
  const joinedTicketsRef = useRef(new Set<string>());
  const [connected, setConnected] = useState(false);
  const [newTickets, setNewTickets] = useState<NewTicketEvent[]>([]);

  useEffect(() => {
    setConnected(false);
    setNewTickets([]);
    if (!merchantId) return;
    let active = true;

    const base = apiBaseUrl.replace(/\/+$/, "");
    const socket = io(`${base}/support`, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("authenticated", () => {
      if (!active) return;
      setConnected(true);
      socket.emit("join_merchant", { merchantId });
      for (const ticketId of joinedTicketsRef.current) socket.emit("join_ticket", { ticketId });
    });

    socket.on("disconnect", () => { if (active) setConnected(false); });
    socket.on("connect_error", () => { if (active) setConnected(false); });
    socket.on("error", () => { if (active) setConnected(false); });

    socket.on("new_ticket", (ticket: NewTicketEvent) => {
      if (!active) return;
      setNewTickets((prev) => [ticket, ...prev]);
    });

    return () => {
      active = false;
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

  // Existing server frames only: support.realtime.v1 and gateway authentication.
  const onCaseUpdated = useCallback((handler: (event: { ticketId: string; status?: string }) => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on("case_updated", handler);
    return () => { socket.off("case_updated", handler); };
  }, []);

  const onConnected = useCallback((handler: () => void) => {
    const socket = socketRef.current;
    if (!socket) return () => {};
    socket.on("authenticated", handler);
    return () => { socket.off("authenticated", handler); };
  }, []);

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
    onCaseUpdated,
    onConnected,
    onTicketTransferred,
  };
}
