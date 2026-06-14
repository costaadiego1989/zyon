import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import type { AacpHttpRequest } from "./http-request.js";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function correlationIdMiddleware(
  request: AacpHttpRequest,
  response: Response,
  next: NextFunction,
): void {
  const supplied = request.header("x-correlation-id")?.trim();
  const correlationId =
    supplied && CORRELATION_ID_PATTERN.test(supplied)
      ? supplied
      : `corr_${randomUUID()}`;

  request.correlationId = correlationId;
  request.headers["x-correlation-id"] = correlationId;
  response.setHeader("x-correlation-id", correlationId);
  next();
}
