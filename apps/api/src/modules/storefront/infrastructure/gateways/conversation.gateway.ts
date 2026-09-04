import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../application/use-cases/get-conversation-history.use-case.js";

interface StorefrontSocket extends Socket {
  merchantId?: string;
  conversationId?: string;
}

@WebSocketGateway({
  namespace: "/storefront",
  cors: {
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
  },
})
@Injectable()
export class StorefrontConversationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(StorefrontConversationGateway.name);

  constructor(
    private readonly sendStoreMessageUseCase: SendStoreMessageUseCase,
    private readonly getConversationHistoryUseCase: GetConversationHistoryUseCase,
  ) {}

  handleConnection(socket: StorefrontSocket) {
    const merchantId = socket.handshake.query?.merchantId as string;
    if (!merchantId) {
      this.logger.warn("WebSocket connection rejected: missing merchantId");
      socket.disconnect();
      return;
    }

    (socket as StorefrontSocket).merchantId = merchantId;
    this.logger.log(`[${merchantId}] WebSocket client connected: ${socket.id}`);
  }

  handleDisconnect(socket: StorefrontSocket) {
    if (socket.merchantId) {
      this.logger.log(`[${socket.merchantId}] WebSocket client disconnected: ${socket.id}`);
    }
  }

  @SubscribeMessage("join_conversation")
  async handleJoinConversation(
    @ConnectedSocket() socket: StorefrontSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!socket.merchantId) {
      socket.emit("error", { message: "unauthorized" });
      return;
    }

    const { conversationId } = data;
    socket.conversationId = conversationId;
    const room = `conversation:${conversationId}`;
    socket.join(room);

    this.logger.log(
      `[${socket.merchantId}] Client ${socket.id} joined conversation ${conversationId}`,
    );
  }

  @SubscribeMessage("leave_conversation")
  handleLeaveConversation(
    @ConnectedSocket() socket: StorefrontSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!socket.merchantId) return;

    const { conversationId } = data;
    const room = `conversation:${conversationId}`;
    socket.leave(room);

    this.logger.log(
      `[${socket.merchantId}] Client ${socket.id} left conversation ${conversationId}`,
    );
  }

  @SubscribeMessage("message")
  async handleMessage(
    @ConnectedSocket() socket: StorefrontSocket,
    @MessageBody() data: { conversationId: string; text: string; cartId?: string },
  ) {
    if (!socket.merchantId) {
      socket.emit("error", { message: "unauthorized" });
      return;
    }

    const { conversationId, text, cartId } = data;
    const room = `conversation:${conversationId}`;

    if (!text?.trim()) {
      socket.emit("error", { message: "message_empty" });
      return;
    }

    try {
      this.server.to(room).emit("typing", { conversationId, isTyping: true });

      const history = await this.getConversationHistoryUseCase.execute({
        merchant_id: socket.merchantId,
        conversation_id: conversationId,
      });

      const result = await this.sendStoreMessageUseCase.execute({
        merchant_id: socket.merchantId,
        conversation_id: conversationId,
        user_message: text,
        cart_id: cartId,
        history: history.messages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
      });

      this.server.to(room).emit("agent_response", {
        conversationId,
        role: "assistant",
        text: result.message,
        blocks: result.blocks,
        cartId: result.cart_id,
      });

      this.server.to(room).emit("typing", { conversationId, isTyping: false });
    } catch (error) {
      this.logger.error(
        `[${socket.merchantId}] Error processing message for conversation ${conversationId}:`,
        error,
      );
      socket.emit("error", { message: "message_processing_failed" });

      this.server.to(room).emit("typing", { conversationId, isTyping: false });
    }
  }
}
