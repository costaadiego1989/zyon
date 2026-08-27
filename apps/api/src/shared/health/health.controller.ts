import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("/health")
  async check() {
    const result = await this.health.check();
    if (result.status === "degraded") {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}