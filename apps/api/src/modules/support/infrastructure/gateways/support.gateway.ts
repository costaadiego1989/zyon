import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { Inject, Logger } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { RealtimeCapabilityService, isRealtimeId, isRealtimeOriginAllowed, realtimeRoom } from "../../../../shared/auth/realtime-capability.js";
import { resolveCorsConfig } from "../../../../shared/config/cors-config.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { AUTH_REPOSITORY, type AuthRepository } from "../../../auth/domain/ports/auth-repository.port.js";
import { SUPPORT_TICKET_REPOSITORY, type SupportTicketRepository } from "../../domain/ports/support-ticket-repository.port.js";
import { SendTicketMessageUseCase } from "../../application/send-ticket-message.use-case.js";

type Credential = { kind: "buyer" | "merchant"; token: string };
interface Connection extends Credential {
  timer: ReturnType<typeof setTimeout>;
  windowStart: number;
  messages: number;
  rooms: Set<string>;
}
type Principal = { kind: "buyer" | "merchant"; merchantId: string; ticketId?: string; expiresAt: number };

@WebSocketGateway({ namespace: "/support", cors: resolveCorsConfig(), maxHttpBufferSize: 16384 })
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SupportGateway.name);
  private readonly connections = new WeakMap<Socket, Connection>();
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(SendTicketMessageUseCase) private readonly sendMessage: SendTicketMessageUseCase,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(AuthCookieService) private readonly cookies: AuthCookieService,
    @Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    @Inject(SUPPORT_TICKET_REPOSITORY) private readonly tickets: SupportTicketRepository,
    @Inject(AUTH_REPOSITORY) private readonly users: AuthRepository,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth ?? {};
      let credential: Credential;
      if (typeof auth.ticketToken === "string") {
        credential = { kind: "buyer", token: auth.ticketToken };
      } else {
        const header = client.handshake.headers.authorization;
        const explicit = typeof auth.accessToken === "string" ? auth.accessToken :
          typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
        const token = explicit || this.cookies.read(client.handshake.headers.cookie);
        // Ambient cookies require an approved browser origin, including upgrades.
        if (!token || (!explicit && !isRealtimeOriginAllowed(client.handshake.headers.origin))) throw new Error("unauthorized");
        credential = { kind: "merchant", token };
      }
      const principal = await this.verify(client, credential);
      if (principal.kind === "buyer") await this.requireTicket(principal, principal.ticketId);
      if (!client.connected) return;
      const timer = setTimeout(() => client.disconnect(true), Math.max(0, principal.expiresAt * 1000 - Date.now()));
      timer.unref();
      this.connections.set(client, { ...credential, timer, windowStart: Date.now(), messages: 0, rooms: new Set() });
      client.emit("authenticated", { role: principal.kind });
    } catch {
      client.emit("error", { message: "unauthorized" });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const connection = this.connections.get(client);
    if (connection) clearTimeout(connection.timer);
    this.connections.delete(client);
  }

  private async verify(client: Socket, credential: Credential): Promise<Principal> {
    const origin = client.handshake.headers.origin;
    if (credential.kind === "buyer") {
      const claims = this.capabilities.verify(credential.token, "support-ticket", origin);
      return { kind: "buyer", merchantId: claims.merchantId, ticketId: claims.resourceId, expiresAt: claims.expiresAt };
    }
    if (origin !== undefined && !isRealtimeOriginAllowed(origin)) throw new Error("origin_not_allowed");
    const user = await this.jwt.authenticate(credential.token);
    const payload = JSON.parse(Buffer.from(credential.token.split(".")[1]!, "base64url").toString("utf8")) as { exp?: number };
    if (!isRealtimeId(user.userId) || !isRealtimeId(user.merchantId) || !Number.isSafeInteger(payload.exp) ||
      payload.exp! <= Math.floor(Date.now() / 1000) || payload.exp! * 1000 - Date.now() > 2147483647) throw new Error("invalid_principal");
    const member = await this.users.findUserByEmail(user.email);
    if (!member || member.id !== user.userId || member.merchantId !== user.merchantId || member.role !== user.role) throw new Error("membership_required");
    return { kind: "merchant", merchantId: user.merchantId, expiresAt: payload.exp! };
  }

  private async authorize(client: Socket): Promise<Principal> {
    const connection = this.connections.get(client);
    if (!connection) throw new Error("unauthorized");
    try { return await this.verify(client, connection); }
    catch (error) { client.disconnect(true); throw error; }
  }

  private async requireTicket(principal: Principal, ticketId: unknown) {
    if (!isRealtimeId(ticketId) || (principal.kind === "buyer" && principal.ticketId !== ticketId)) throw new Error("ticket_not_found");
    const ticket = await this.tickets.get(principal.merchantId, ticketId);
    if (!ticket) throw new Error("ticket_not_found");
    return ticket;
  }

  @SubscribeMessage("join_merchant")
  async handleJoinMerchant(@ConnectedSocket() client: Socket, @MessageBody() data?: { merchantId?: string }) {
    try {
      const principal = await this.authorize(client);
      if (principal.kind !== "merchant" || (data?.merchantId !== undefined && data.merchantId !== principal.merchantId)) throw new Error("forbidden");
      const room = realtimeRoom("merchant", principal.merchantId);
      await client.join(room);
      return { joined: room };
    } catch { return { success: false, error: "unauthorized" }; }
  }

  @SubscribeMessage("join_ticket")
  async handleJoinTicket(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId: string; agentName?: string }) {
    try {
      const principal = await this.authorize(client);
      const ticket = await this.requireTicket(principal, data?.ticketId);
      const room = realtimeRoom("ticket", principal.merchantId, ticket.id);
      const connection = this.connections.get(client)!;
      if (connection.rooms.size >= 32 && !connection.rooms.has(room)) return { success: false, error: "room_limit" };
      connection.rooms.add(room);
      await client.join(room);
      if (principal.kind === "merchant") this.server.to(room).emit("agent_joined", { ticketId: ticket.id, agentName: "Atendente" });
      return { joined: room };
    } catch { return { success: false, error: "unauthorized" }; }
  }

  @SubscribeMessage("leave_ticket")
  async handleLeaveTicket(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId: string }) {
    try {
      const principal = await this.authorize(client);
      if (!isRealtimeId(data?.ticketId)) throw new Error("invalid_ticket");
      const room = realtimeRoom("ticket", principal.merchantId, data.ticketId);
      await client.leave(room);
      this.connections.get(client)?.rooms.delete(room);
      return { left: room };
    } catch { return { success: false, error: "unauthorized" }; }
  }

  @SubscribeMessage("send_message")
  async handleSendMessage(@ConnectedSocket() client: Socket, @MessageBody() data: { ticketId: string; merchantId?: string; content: string; senderName?: string }) {
    try {
      const principal = await this.authorize(client);
      if (data?.merchantId !== undefined && data.merchantId !== principal.merchantId) throw new Error("forbidden");
      if (typeof data?.content !== "string" || !data.content.trim() || data.content.length > 4000) return { success: false, error: "invalid_message" };
      const connection = this.connections.get(client)!;
      if (Date.now() - connection.windowStart >= 60000) { connection.windowStart = Date.now(); connection.messages = 0; }
      if (++connection.messages > 30) return { success: false, error: "rate_limited" };
      const ticket = await this.requireTicket(principal, data.ticketId);
      const message = await this.sendMessage.execute({
        ticketId: ticket.id, merchantId: principal.merchantId,
        senderType: principal.kind, content: data.content.trim(),
      });
      const enriched = { ...message, senderName: principal.kind === "merchant" ? "Atendente" : undefined };
      this.server.to(realtimeRoom("ticket", principal.merchantId, ticket.id)).emit("new_message", enriched);
      return { success: true, message };
    } catch {
      this.logger.debug("Support socket message rejected or failed");
      return { success: false, error: "send_failed" };
    }
  }

  emitNewTicket(merchantId: string, ticket: { id: string; buyerMessage: string; sessionId?: string }) {
    this.server.to(realtimeRoom("merchant", merchantId)).emit("new_ticket", ticket);
  }

  emitBuyerMessage(merchantId: string, ticketId: string, message: { id: string; content: string; createdAt: string }) {
    this.server.to(realtimeRoom("ticket", merchantId, ticketId)).emit("new_message", { ...message, ticketId, senderType: "buyer" });
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
