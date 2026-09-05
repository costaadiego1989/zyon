import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { RealtimeCapabilityService, isRealtimeId, realtimeRoom } from "../../../../shared/auth/realtime-capability.js";
import { resolveCorsConfig } from "../../../../shared/config/cors-config.js";
import { SendStoreMessageUseCase } from "../../application/use-cases/send-store-message.use-case.js";
import { GetConversationHistoryUseCase } from "../../application/use-cases/get-conversation-history.use-case.js";

interface Connection {
  token: string;
  timer: ReturnType<typeof setTimeout>;
  windowStart: number;
  messages: number;
  processing: boolean;
}

@WebSocketGateway({ namespace: "/storefront", cors: resolveCorsConfig(), maxHttpBufferSize: 16384 })
@Injectable()
export class StorefrontConversationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(StorefrontConversationGateway.name);
  private readonly connections = new WeakMap<Socket, Connection>();

  constructor(
    @Inject(SendStoreMessageUseCase) private readonly sendStoreMessageUseCase: SendStoreMessageUseCase,
    @Inject(GetConversationHistoryUseCase) private readonly getConversationHistoryUseCase: GetConversationHistoryUseCase,
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
  ) {}

  handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.conversationToken;
      const claims = this.capabilities.verify(token, "storefront-conversation", socket.handshake.headers.origin);
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, claims.expiresAt * 1000 - Date.now()));
      timer.unref();
      this.connections.set(socket, { token, timer, windowStart: Date.now(), messages: 0, processing: false });
    } catch {
      socket.emit("error", { message: "unauthorized" });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    const connection = this.connections.get(socket);
    if (connection) clearTimeout(connection.timer);
    this.connections.delete(socket);
  }

  private authorize(socket: Socket, conversationId: unknown) {
    const connection = this.connections.get(socket);
    if (!connection) throw new Error("unauthorized");
    try {
      const claims = this.capabilities.verify(connection.token, "storefront-conversation", socket.handshake.headers.origin);
      if (!isRealtimeId(conversationId) || claims.resourceId !== conversationId) throw new Error("forbidden");
      return claims;
    } catch (error) {
      socket.disconnect(true);
      throw error;
    }
  }

  @SubscribeMessage("join_conversation")
  async handleJoinConversation(@ConnectedSocket() socket: Socket, @MessageBody() data: { conversationId: string }) {
    try {
      const claims = this.authorize(socket, data?.conversationId);
      await socket.join(realtimeRoom("conversation", claims.merchantId, claims.resourceId));
      return { joined: claims.resourceId };
    } catch { return { success: false, error: "unauthorized" }; }
  }

  @SubscribeMessage("leave_conversation")
  async handleLeaveConversation(@ConnectedSocket() socket: Socket, @MessageBody() data: { conversationId: string }) {
    try {
      const claims = this.authorize(socket, data?.conversationId);
      await socket.leave(realtimeRoom("conversation", claims.merchantId, claims.resourceId));
      return { left: claims.resourceId };
    } catch { return { success: false, error: "unauthorized" }; }
  }

  @SubscribeMessage("message")
  async handleMessage(@ConnectedSocket() socket: Socket, @MessageBody() data: { conversationId: string; text: string; cartId?: string }) {
    let room: string | undefined;
    let connection: Connection | undefined;
    try {
      const claims = this.authorize(socket, data?.conversationId);
      if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 4000) {
        return { success: false, error: "invalid_message" };
      }
      if (data.cartId !== undefined && data.cartId !== claims.resourceId) {
        return { success: false, error: "forbidden_cart" };
      }
      connection = this.connections.get(socket)!;
      if (connection.processing) return { success: false, error: "message_in_progress" };
      if (Date.now() - connection.windowStart >= 60000) {
        connection.windowStart = Date.now(); connection.messages = 0;
      }
      if (++connection.messages > 20) return { success: false, error: "rate_limited" };
      connection.processing = true;
      room = realtimeRoom("conversation", claims.merchantId, claims.resourceId);
      this.server.to(room).emit("typing", { conversationId: claims.resourceId, isTyping: true });
      const history = await this.getConversationHistoryUseCase.execute({ merchant_id: claims.merchantId, conversation_id: claims.resourceId });
      const result = await this.sendStoreMessageUseCase.execute({
        merchant_id: claims.merchantId, conversation_id: claims.resourceId,
        user_message: data.text.trim(), cart_id: claims.resourceId,
        history: history.messages.map((message) => ({ role: message.role, content: message.content })),
      });
      this.server.to(room).emit("agent_response", {
        conversationId: claims.resourceId, role: "assistant", text: result.message,
        blocks: result.blocks, cartId: result.cart_id,
      });
      return { success: true };
    } catch {
      this.logger.debug("Storefront socket message rejected or failed");
      return { success: false, error: "message_failed" };
    } finally {
      // Only the call that acquired the processing slot may release it.
      if (room && connection) {
        connection.processing = false;
        this.server.to(room).emit("typing", { conversationId: data.conversationId, isTyping: false });
      }
    }
  }
}
