import { IdempotencyKeySchema } from "@aacp/contracts";
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import type { Response } from "express";
import {
  catchError,
  from,
  map,
  mergeMap,
  Observable,
  of,
  throwError,
} from "rxjs";
import { currentTenantPrincipal } from "../../auth/tenant-principal.js";
import { canonicalJson } from "../canonical-json.js";
import type { AacpHttpRequest } from "../http-request.js";
import {
  IDEMPOTENCY_OPTIONS,
  type IdempotencyOptions,
} from "./idempotent.decorator.js";
import type { IdempotencyRepository } from "./idempotency.repository.js";

export const IDEMPOTENCY_REPOSITORY = Symbol("IDEMPOTENCY_REPOSITORY");
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly repository: IdempotencyRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IdempotencyOptions>(
      IDEMPOTENCY_OPTIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<AacpHttpRequest>();
    const response = http.getResponse<Response>();
    const principal = currentTenantPrincipal(request);
    const idempotencyKey = parseIdempotencyKey(
      request.header("idempotency-key"),
    );
    const route = (request.originalUrl ?? request.url).split("?")[0];
    const requestFingerprint = fingerprint({
      method: request.method,
      route,
      query: request.query,
      body: request.body,
    });
    const expiresAt = new Date(
      Date.now() + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1_000,
    );

    return from(
      this.repository.claim({
        merchantId: principal.tenantId,
        idempotencyKey,
        requestFingerprint,
        method: request.method,
        route,
        expiresAt,
      }),
    ).pipe(
      mergeMap((claim) => {
        if (claim.outcome === "payload_mismatch") {
          throw new ConflictException({
            code: "idempotency_key_reused",
            detail:
              "This Idempotency-Key was already used with a different request payload.",
          });
        }
        if (claim.outcome === "in_progress") {
          throw new ConflictException({
            code: "idempotency_request_in_progress",
            detail:
              "A request with this Idempotency-Key is already being processed.",
          });
        }
        if (claim.outcome === "replay") {
          response.status(claim.replay.statusCode);
          response.setHeader("Idempotency-Replayed", "true");
          for (const [name, value] of Object.entries(
            claim.replay.responseHeaders,
          )) {
            response.setHeader(name, value);
          }
          return of(claim.replay.responseBody);
        }

        return next.handle().pipe(
          catchError((error: unknown) =>
            from(
              this.repository.release(
                claim.recordId,
                principal.tenantId,
                requestFingerprint,
              ),
            ).pipe(mergeMap(() => throwError(() => error))),
          ),
          mergeMap((body) =>
            from(
              this.repository.complete(
                claim.recordId,
                principal.tenantId,
                requestFingerprint,
                {
                  statusCode: response.statusCode,
                  responseBody: body,
                  responseHeaders: replayableHeaders(response),
                },
              ),
            ).pipe(map(() => body)),
          ),
        );
      }),
    );
  }
}

function parseIdempotencyKey(value: string | undefined): string {
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_idempotency_key",
      detail:
        "Idempotency-Key is required and must contain 8-255 URL-safe characters.",
    });
  }
  return parsed.data;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function replayableHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ["etag", "location"]) {
    const value = response.getHeader(name);
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}
