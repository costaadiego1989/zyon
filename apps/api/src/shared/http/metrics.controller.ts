import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { getMetricsRegistry } from "./metrics.middleware.js";

@Controller("metrics")
export class MetricsController {
  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    const registry = getMetricsRegistry();
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  }
}
