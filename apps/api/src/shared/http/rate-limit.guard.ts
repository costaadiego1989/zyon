import { createHash } from "node:crypto";
import { Injectable, type CanActivate, type ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthCookieService } from "../../modules/auth/domain/services/auth-cookie.service.js";
import { JwtService } from "../../modules/auth/domain/services/jwt.service.js";
import { DistributedRateLimitStore, type QuotaDecision } from "./rate-limit.store.js";

const RATE_LIMIT_KEY = "rate-limit";
const PROBE_PATHS = new Set(["/health", "/ready", "/readyz", "/livez", "/metrics"]);

/** An additional per-minute quota for a handler or controller. */
export function RateLimit(requestsPerMinute: number): MethodDecorator & ClassDecorator {
  if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) throw new Error("invalid_route_rate_limit");
  return (target: object, _propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(RATE_LIMIT_KEY, requestsPerMinute, descriptor?.value ?? target);
  };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: DistributedRateLimitStore,
    private readonly jwt: JwtService,
    private readonly cookies: AuthCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    // Express applies the configured trust-proxy policy. Never read raw
    // X-Forwarded-For or use caller-chosen resource IDs as quota buckets.
    const path = (request.path ?? request.url ?? "").split("?")[0];
    if (PROBE_PATHS.has(path)) return true;
    const ipKey = `ip:${digest(request.ip ?? request.socket?.remoteAddress ?? "unknown")}`;
    await this.enforce(ipKey, this.store.options.ipMax, this.store.options.windowMs, request, response);
    const handlerLimit = this.reflector.getAllAndOverride<number>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    const routeKey = digest(`${context.getClass().name}:${context.getHandler().name}`);
    if (handlerLimit !== undefined) await this.enforce(`${ipKey}:route:${routeKey}`, handlerLimit, 60_000, request, response);

    const header = request.headers?.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    const cookie = request.headers?.cookie;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice(7) : this.cookies.read(typeof cookie === "string" ? cookie : undefined);
    if (token) {
      let merchantId: string | undefined;
      try {
        // APP_GUARD precedes route authentication. Verify only for quotas here;
        // route guards still authorize the operation and assign the principal.
        merchantId = (await this.jwt.authenticate(token)).merchantId;
      } catch (error) {
        // Invalid credentials retain their anonymous quota. Infrastructure
        // failures cannot silently disable tenant quotas.
        if (!(error instanceof Error) || !error.message.startsWith("jwt_")) throw unavailable();
      }
      if (merchantId) {
        const tenantKey = `tenant:${digest(merchantId)}`;
        await this.enforce(tenantKey, this.store.options.tenantMax, 60_000, request, response);
        if (handlerLimit !== undefined) await this.enforce(`${tenantKey}:route:${routeKey}`, handlerLimit, 60_000, request, response);
      }
    }
    return true;
  }

  private async enforce(key: string, limit: number, windowMs: number, request: any, response: any): Promise<void> {
    let decision: QuotaDecision;
    try { decision = await this.store.hit(key, limit, windowMs); }
    catch { throw unavailable(); }
    response.setHeader("X-RateLimit-Limit", String(limit));
    response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
      throw new HttpException({ status: 429, title: "Too Many Requests", code: "rate_limited",
        detail: "Request quota exceeded. Retry after the indicated interval.", correlation_id: request.correlationId,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function unavailable(): HttpException {
  return new HttpException({ status: 503, code: "rate_limit_unavailable", title: "Service Unavailable" }, HttpStatus.SERVICE_UNAVAILABLE);
}
