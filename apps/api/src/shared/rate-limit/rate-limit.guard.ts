import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import {
  RATE_LIMIT_OPTIONS_KEY,
  SKIP_RATE_LIMIT_KEY,
  type RateLimitOverride,
} from "./rate-limit.decorators.js";
import type { RateLimitStore } from "./rate-limit.store.js";
import type { RateLimitOptions } from "./rate-limit.options.js";

/**
 * Default paths excluded from rate limiting (health, readiness, metrics).
 * Routes can also opt out via @SkipRateLimit().
 */
const DEFAULT_EXCLUDED_PATHS = new Set<string>(["/health", "/ready", "/readyz", "/livez", "/metrics"]);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    private readonly options: RateLimitOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const override = this.reflector.getAllAndOverride<RateLimitOverride>(RATE_LIMIT_OPTIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!request) return true;

    const path = this.normalizedPath(request);
    if (DEFAULT_EXCLUDED_PATHS.has(path)) return true;

    const limit = override?.limit ?? this.options.max;
    const windowMs = override?.windowMs ?? this.options.windowMs;
    if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
      // Defensive: invalid config should never block traffic.
      this.logger.warn(
        `Invalid rate-limit config (limit=${limit}, windowMs=${windowMs}) — skipping check`,
      );
      return true;
    }

    const key = this.buildKey(request, override !== undefined);
    const decision = this.store.hit(key, limit, windowMs);

    response.setHeader("X-RateLimit-Limit", String(decision.limit));
    response.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    response.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      const retryAfterSeconds = Math.max(Math.ceil(decision.retryAfterMs / 1000), 1);
      response.setHeader("Retry-After", String(retryAfterSeconds));
      this.logger.warn(
        `Rate limit exceeded for ${key} (remaining=${decision.remaining}, limit=${limit}) on ${request.method} ${path}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message: "rate_limit_exceeded",
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private normalizedPath(request: Request): string {
    const base = (request.baseUrl ?? "") + (request.path ?? request.url ?? "");
    const stripped = base.split("?")[0]?.split("#")[0] ?? "";
    return stripped || "/";
  }

  private buildKey(request: Request, includePath: boolean): string {
    const ip = this.extractIp(request);
    return includePath ? `${ip}:${this.normalizedPath(request)}` : ip;
  }

  private extractIp(request: Request): string {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    if (Array.isArray(forwarded) && forwarded.length > 0 && typeof forwarded[0] === "string") {
      return forwarded[0].split(",")[0]?.trim() || forwarded[0];
    }
    return request.ip ?? request.socket?.remoteAddress ?? "unknown";
  }
}
