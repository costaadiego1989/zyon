import { Inject, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { WebSocketGateway, SubscribeMessage, ConnectedSocket, MessageBody, type OnGatewayConnection, type OnGatewayDisconnect } from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { resolveCorsConfig } from "../../../shared/config/cors-config.js";
import { isRealtimeOriginAllowed } from "../../../shared/auth/realtime-capability.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { PlatformJwtService } from "../../platform-control/domain/services/platform-jwt.service.js";
import { hasPlatformPermission } from "../../platform-control/domain/platform-operator.js";
import { PlatformSupportService } from "../application/platform-support.service.js";
import { SupportError, type SupportActor } from "../domain/platform-support.js";
import { PlatformSupportRelay, type SupportChange } from "../infrastructure/platform-support-relay.js";
import { supportBody } from "./platform-support.controller.js";

type Connection = { token: string; kind: "merchant" | "operator"; actor: SupportActor; expires: ReturnType<typeof setTimeout> };

@WebSocketGateway({ namespace: "/platform-support", cors: resolveCorsConfig(), maxHttpBufferSize: 16_384, transports: ["websocket"] })
export class PlatformSupportGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  private readonly connections = new Map<Socket, Connection>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly changed = (event: SupportChange) => { void this.notify(event); };

  constructor(
    @Inject(PlatformSupportService) private readonly support: PlatformSupportService,
    @Inject(JwtService) private readonly merchantJwt: JwtService,
    @Inject(PlatformJwtService) private readonly operatorJwt: PlatformJwtService,
    @Inject(AuthCookieService) private readonly cookies: AuthCookieService,
    @Inject(PlatformSupportRelay) private readonly relay: PlatformSupportRelay,
  ) {}

  onModuleInit() {
    this.relay.events.on("changed", this.changed);
    this.heartbeat = setInterval(() => { for (const client of this.connections.keys()) void this.authorize(client).catch(() => client.disconnect(true)); }, 30_000);
    this.heartbeat.unref();
  }

  onModuleDestroy() {
    clearInterval(this.heartbeat);
    this.relay.events.off("changed", this.changed);
    for (const client of this.connections.keys()) client.disconnect(true);
  }

  async handleConnection(client: Socket) {
    try {
      if (this.connections.size >= 2000) throw new Error("connection_limit");
      const origin = client.handshake.headers.origin;
      const auth = client.handshake.auth ?? {};
      const kind = auth.kind === "operator" ? "operator" : "merchant";
      const explicit = typeof auth.accessToken === "string" ? auth.accessToken : undefined;
      const token = explicit || (kind === "merchant" ? this.cookies.read(client.handshake.headers.cookie) : undefined);
      if (!token || (origin !== undefined && !isRealtimeOriginAllowed(origin)) || (!explicit && !isRealtimeOriginAllowed(origin))) throw new Error("unauthorized");
      const actor = await this.authenticate(kind, token);
      const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as { exp: number };
      const ttl = payload.exp * 1000 - Date.now();
      if (!Number.isSafeInteger(payload.exp) || ttl <= 0 || ttl > 2_147_483_647 || !client.connected) throw new Error("unauthorized");
      const expires = setTimeout(() => client.disconnect(true), ttl);
      expires.unref();
      this.connections.set(client, { kind, token, actor, expires });
      client.emit("authenticated", { kind });
    } catch { client.emit("support_error", { code: "unauthorized" }); client.disconnect(true); }
  }

  handleDisconnect(client: Socket) {
    const state = this.connections.get(client);
    if (state) clearTimeout(state.expires);
    this.connections.delete(client);
  }

  @SubscribeMessage("send_message")
  async send(@ConnectedSocket() client: Socket, @MessageBody() data: unknown) {
    try {
      const actor = await this.authorize(client);
      const body = supportBody(data, ["ticketId", "content", "clientMessageId"]);
      const message = await this.support.send(actor, body.ticketId, body);
      return { success: true, message };
    } catch (error) { return { success: false, code: error instanceof SupportError ? error.code : "unauthorized" }; }
  }

  private async authenticate(kind: Connection["kind"], token: string): Promise<SupportActor> {
    if (kind === "operator") {
      const principal = await this.operatorJwt.authenticate(token);
      if (!hasPlatformPermission(principal.role, "platform:support:read") || !hasPlatformPermission(principal.role, "platform:support:write")) throw new Error("forbidden");
      return { kind, id: principal.operatorId, canAssign: principal.role === "platform_admin" };
    }
    const principal = await this.merchantJwt.authenticate(token);
    return { kind, id: principal.userId, merchantId: principal.merchantId };
  }

  private async authorize(client: Socket) {
    const state = this.connections.get(client);
    if (!state) throw new Error("unauthorized");
    try {
      const actor = await this.authenticate(state.kind, state.token);
      state.actor = actor;
      return actor;
    } catch { client.disconnect(true); throw new Error("unauthorized"); }
  }

  private async notify(event: SupportChange) {
    await Promise.allSettled([...this.connections].map(async ([client, state]) => {
      if (state.actor.kind === "merchant" && state.actor.merchantId !== event.merchantId) return;
      // Revalidate before server-originated delivery too: logout and role revocation
      // cannot leave a previously subscribed socket receiving tenant updates.
      await this.authorize(client);
      if (client.connected) client.emit("support_changed", { ticketId: event.ticketId });
    }));
  }
}
