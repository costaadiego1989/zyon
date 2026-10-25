import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { ExperimentMeasurementService } from "../../application/experiment-measurement.service.js";

@Controller("revenue-manager/experiments")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("revenueManager")
export class ExperimentMeasurementController {
  constructor(private readonly measurement: ExperimentMeasurementService) {}

  @Get(":id/measurement")
  read(@Req() req: any, @Param("id") id: string) {
    return this.measurement.read(currentUser(req).merchantId, id);
  }

  @Post(":id/measurement-plan")
  prepare(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    if (body != null && (typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)) {
      throw new BadRequestException("EXPERIMENT_PLAN_USES_SERVER_CONFIGURATION");
    }
    return this.measurement.prepare(currentUser(req).merchantId, id);
  }

  @Post(":id/reviews")
  capture(@Req() req: any, @Param("id") id: string, @Body() body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => key !== "request_key")
      || typeof (body as { request_key?: unknown }).request_key !== "string") {
      throw new BadRequestException("EXPERIMENT_REVIEW_KEY_REQUIRED");
    }
    return this.measurement.capture(currentUser(req).merchantId, id, (body as { request_key: string }).request_key);
  }
}
