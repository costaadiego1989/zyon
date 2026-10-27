import type { NextFunction, Response } from "express";
import type { AacpHttpRequest } from "./http-request.js";
import { CorrelationIdMiddleware } from "../logger/correlation-id.middleware.js";

const middleware = new CorrelationIdMiddleware();

export function correlationIdMiddleware(
  request: AacpHttpRequest,
  response: Response,
  next: NextFunction,
): void {
  middleware.use(request, response, next);
}
