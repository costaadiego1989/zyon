import { Controller, Get, Header, Headers, Res, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { isProduction } from "../config/secret-config.js";
import { MetricsService } from "./metrics.service.js";

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async getMetrics(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ops-secret") opsSecret: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    assertMetricsAccess(authorization, opsSecret);
    const body = await this.metrics.getMetrics();
    res.send(body);
  }
}

function assertMetricsAccess(authorization?: string, opsSecret?: string): void {
  if (!isProduction(process.env.NODE_ENV)) return;
  const expected = process.env.OPS_SHARED_SECRET?.trim();
  if (!expected) throw new UnauthorizedException("metrics_disabled");
  if (opsSecret?.trim() === expected) return;
  if (authorization === `Bearer ${expected}`) return;
  throw new UnauthorizedException("metrics_unauthorized");
}
