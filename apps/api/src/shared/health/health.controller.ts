import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("/health")
  liveness() {
    return this.health.liveness();
  }

  @Get("/ready")
  async readiness() {
    const result = await this.health.readiness();
    if (!result.ready) {
      throw new HttpException(
        { status: "unavailable", db: result.db },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    return { status: "ready", db: result.db };
  }
}