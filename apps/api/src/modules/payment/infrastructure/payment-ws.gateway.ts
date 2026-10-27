import { Inject, Injectable, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { WebSocketServer, type WebSocket } from "ws";
import { REDIS_CLIENT_TOKEN } from "../../../shared/cache/redis.module.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";

type RedisClient = any; // ioredis v5 ESM compatibility

interface SocketWithAuth extends WebSocket {
  merchantId?: string;
  subscriber?: RedisClient;
}

interface StatusChangedMessage {
  event: "payment.status_changed";
  intentId: string;
  status: string;
  merchantId: string;
  at: string;
}

/**
 * Payment status WebSocket — a raw `ws` server mounted on the shared HTTP
 * server at path `/ws`, using `noServer` + manual upgrade handling. This
 * coexists with the existing socket.io gateways (/storefront, /support) that
 * use the default socket.io adapter — we do NOT replace the app's WS adapter.
 *
 * Flow: client connects ws://host/ws?token={embedToken}, sends
 * { event:"subscribe", intentId }, receives { event:"payment.status_changed" }
 * when a webhook publishes to the Redis channel `payment:status:{intentId}`.
 */
@Injectable()
export class PaymentWebSocketGateway implements OnModuleInit {
  private readonly logger = new Logger(PaymentWebSocketGateway.name);
  private wss?: WebSocketServer;

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: RedisClient | null,
    private readonly embedTokenService: EmbedTokenService,
    private readonly adapterHost: HttpAdapterHost,
    @Optional() private readonly metricsService?: MetricsService
  ) {}

  onModuleInit(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer?.();
    if (!httpServer) {
      this.logger.warn("HTTP server unavailable — payment WebSocket disabled");
      return;
    }

    this.wss = new WebSocketServer({ noServer: true });

    // Route only /ws upgrades to this server; leave other paths (socket.io) alone.
    httpServer.on("upgrade", (req: any, socket: any, head: Buffer) => {
      let pathname = "";
      try {
        pathname = new URL(req.url, "http://localhost").pathname;
      } catch {
        pathname = (req.url || "").split("?")[0];
      }
      if (pathname !== "/ws") return; // not ours — socket.io handles its own
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.wss!.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (socket: SocketWithAuth, req: any) => {
      void this.handleConnection(socket, req);
    });

    this.logger.log("Payment WebSocket server mounted at /ws");
  }

  private async handleConnection(socket: SocketWithAuth, req: any): Promise<void> {
    try {
      const token = this.extractToken(req?.url ?? "");
      if (!token) {
        socket.close(4001, "Missing authentication token");
        return;
      }
      const claims = this.embedTokenService.verify(token);
      socket.merchantId = claims.merchantId;
      this.metricsService?.activeWsConnections?.inc();
      this.logger.debug(`WS connected: merchant=${claims.merchantId}`);

      socket.on("message", (raw: Buffer) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg?.event === "subscribe" && typeof msg.intentId === "string") {
          void this.handleSubscribe(socket, msg.intentId);
        }
      });

      socket.on("close", () => void this.handleDisconnect(socket));
    } catch (error) {
      this.logger.warn(`WS rejected: ${(error as Error).message}`);
      socket.close(4001, "Authentication failed");
    }
  }

  private async handleDisconnect(socket: SocketWithAuth): Promise<void> {
    if (socket.subscriber) {
      try {
        await socket.subscriber.unsubscribe();
        await socket.subscriber.quit();
      } catch (error) {
        this.logger.error(`Redis subscriber cleanup failed: ${(error as Error).message}`);
      }
      socket.subscriber = undefined;
    }
    this.metricsService?.activeWsConnections?.dec();
    this.logger.debug(`WS disconnected: merchant=${socket.merchantId}`);
  }

  private async handleSubscribe(socket: SocketWithAuth, intentId: string): Promise<void> {
    if (!socket.merchantId) {
      socket.close(4001, "Not authenticated");
      return;
    }
    if (!this.redis) {
      this.logger.debug(`Redis unavailable — no realtime for intent ${intentId}`);
      return;
    }

    try {
      // Recovery: if a terminal status was already published, send it now.
      const lastJson = await this.redis.get(`payment:status:last:${intentId}`);
      if (lastJson) {
        const last = JSON.parse(lastJson);
        this.send(socket, last);
        if (this.isTerminal(last.status)) {
          setTimeout(() => socket.close(1000, "Terminal status"), 500);
          return;
        }
      }

      const subscriber = this.redis.duplicate();
      socket.subscriber = subscriber;
      const channel = `payment:status:${intentId}`;

      subscriber.on("message", (ch: string, message: string) => {
        if (ch !== channel) return;
        try {
          const payload = JSON.parse(message);
          this.send(socket, payload);
          if (this.isTerminal(payload.status)) {
            setTimeout(() => socket.close(1000, "Terminal status"), 500);
          }
        } catch (error) {
          this.logger.error(`Redis msg parse failed: ${(error as Error).message}`);
        }
      });
      subscriber.on("error", (error: Error) => {
        this.logger.error(`Redis subscriber error: ${error.message}`);
      });

      await subscriber.subscribe(channel);
    } catch (error) {
      this.logger.error(`Subscribe failed: ${(error as Error).message}`);
    }
  }

  private send(socket: SocketWithAuth, payload: any): void {
    const msg: StatusChangedMessage = {
      event: "payment.status_changed",
      intentId: payload.intentId,
      status: payload.status,
      merchantId: payload.merchantId,
      at: payload.at,
    };
    try { socket.send(JSON.stringify(msg)); } catch { /* socket closed */ }
  }

  private isTerminal(status: string): boolean {
    return status === "approved" || status === "failed" || status === "expired";
  }

  private extractToken(url: string): string | null {
    const match = url.match(/[?&]token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}
