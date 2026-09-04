import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type { AacpHttpRequest } from "../http/http-request.js";
import { CorrelationIdStorage } from "./correlation-id.storage.js";

/**
 * Generates (or accepts an inbound) correlation id, stores it in an
 * AsyncLocalStorage frame, exposes it on the request, and echoes it back
 * on the response so callers can correlate their own logs with ours.
 *
 * Inbound ids that fail {@link CorrelationIdStorage.PATTERN} are rejected
 * to prevent log injection from untrusted callers.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: AacpHttpRequest,
    response: Response,
    next: NextFunction,
  ): void {
    const supplied = request.header(CorrelationIdStorage.HEADER)?.trim();
    const correlationId =
      supplied && CorrelationIdStorage.isValid(supplied)
        ? supplied
        : `corr_${randomUUID()}`;

    request.correlationId = correlationId;
    request.headers[CorrelationIdStorage.HEADER] = correlationId;
    response.setHeader(CorrelationIdStorage.HEADER, correlationId);

    CorrelationIdStorage.run(correlationId, () => next());
  }
}