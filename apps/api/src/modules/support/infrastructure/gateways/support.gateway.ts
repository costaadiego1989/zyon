import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { SendTicketMessageUseCase } from "../../application/send-ticket-message.use-case.js";

@WebSocketGateway({ namespace: "/support", cors: { origin: "*" } })
export class SupportGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(SupportGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly sendMessage: SendTicketMessageUseCase) {}

  handleDisconnect(client: Socket) {
    this.logger.debug(`Support client disconnected: ${client.id}`);
  }

  /** Merchant joins their merchant room to receive new ticket notifications */
  @SubscribeMessage("join_merchant")
  handleJoinMerchant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { merchantId: string },
  ) {
    const room = `merchant:${data.merchantId}`;
    void client.join(room);
    this.logger.debug(`Client ${client.id} joined ${room}`);
    return { joined: room };
  }

  /** Merchant joins a specific ticket room to receive messages */
  @SubscribeMessage("join_ticket")
  handleJoinTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: string; agentName?: string },
  ) {
    const room = `ticket:${data.ticketId}`;
    void client.join(room);
    this.logger.debug(`Client ${client.id} joined ${room}`);

    // Notify buyer that an agent joined the chat
    if (data.agentName) {
      this.server.to(`buyer:${data.ticketId}`).emit("agent_joined", {
        ticketId: data.ticketId,
        agentName: data.agentName,
      });
    }

    return { joined: room };
  }

  /** Merchant leaves a ticket room */
  @SubscribeMessage("leave_ticket")
  handleLeaveTicket(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: string },
  ) {
    const room = `ticket:${data.ticketId}`;
    void client.leave(room);
    return { left: room };
  }

  /** Merchant sends a message to buyer via ticket */
  @SubscribeMessage("send_message")
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: string; merchantId: string; content: string; senderName?: string },
  ) {
    try {
      const message = await this.sendMessage.execute({
        ticketId: data.ticketId,
        merchantId: data.merchantId,
        senderType: "merchant",
        content: data.content,
      });

      const enriched = { ...message, senderName: data.senderName };

      // Emit to all clients in ticket room (including sender for confirmation)
      this.server.to(`ticket:${data.ticketId}`).emit("new_message", enriched);

      // Emit to buyer's conversation room
      this.server.to(`buyer:${data.ticketId}`).emit("merchant_reply", enriched);

      return { success: true, message };
    } catch (error) {
      this.logger.error(`send_message failed: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, error: "send_failed" };
    }
  }

  /** Called by other services to notify merchant of new ticket */
  emitNewTicket(merchantId: string, ticket: { id: string; buyerMessage: string; sessionId?: string }) {
    this.server.to(`merchant:${merchantId}`).emit("new_ticket", ticket);
  }

  /** Called by other services to emit buyer message to merchant in ticket room */
  emitBuyerMessage(ticketId: string, message: { id: string; content: string; createdAt: string }) {
    this.server.to(`ticket:${ticketId}`).emit("new_message", {
      ...message,
      ticketId,
      senderType: "buyer",
    });
  }

  /** Notify both origin and target merchant rooms that a ticket was transferred */
  emitTicketTransferred(
    fromMerchantId: string,
    toMerchantId: string,
    payload: {
      ticketId: string;
      fromMerchantId: string;
      toMerchantId: string;
      toStoreName: string;
    },
  ) {
    this.server.to(`merchant:${fromMerchantId}`).emit("ticket_transferred", payload);
    this.server.to(`merchant:${toMerchantId}`).emit("ticket_transferred", payload);
  }
}
