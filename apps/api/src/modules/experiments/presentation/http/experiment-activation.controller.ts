import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { currentTenantPrincipal, type TenantPrincipalRequest } from "../../../../shared/auth/tenant-principal.js";
import { PlanLimitGuard, RequirePlanFeature } from "../../../payment/domain/billing-plan-guard.js";
import { ExperimentActivationService } from "../../application/experiment-activation.service.js";
import { ExperimentMeasurementService } from "../../application/experiment-measurement.service.js";
import { GetExperimentUseCase } from "../../application/use-cases/get-experiment.use-case.js";

const approvalBody = z.object({ expected_review_hash: z.string().regex(/^[a-f0-9]{64}$/),
  request_key: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), acknowledged: z.literal(true) }).strict();

@Controller("dashboard/experiments")
@UseGuards(AuthGuard, PlanLimitGuard)
@RequirePlanFeature("abTests")
export class ExperimentActivationController {
  constructor(@Inject(ExperimentActivationService) private readonly activation: ExperimentActivationService,
    @Inject(ExperimentMeasurementService) private readonly measurement: ExperimentMeasurementService,
    @Inject(GetExperimentUseCase) private readonly getExperiment: GetExperimentUseCase) {}

  @Get(":id/activation-review")
  review(@Req() req: TenantPrincipalRequest, @Param("id") id: string) {
    return this.activation.review(currentTenantPrincipal(req).tenantId, id);
  }

  @Post(":id/prepare-activation")
  async prepare(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Body() body: unknown) {
    if (!z.object({}).strict().safeParse(body).success) throw new BadRequestException("EXPERIMENT_PLAN_USES_SERVER_CONFIGURATION");
    const principal = currentTenantPrincipal(req);
    await this.measurement.prepare(principal.tenantId, id);
    return this.activation.review(principal.tenantId, id);
  }

  @Post(":id/approve-and-start")
  async approve(@Req() req: TenantPrincipalRequest, @Param("id") id: string, @Body() body: unknown) {
    const parsed = approvalBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("EXPERIMENT_APPROVAL_INPUT_INVALID");
    const principal = currentTenantPrincipal(req);
    const approval = await this.activation.activate(principal, id, parsed.data);
    return { approval: { reviewHash: approval.reviewHash, actorUserId: approval.actorUserId,
      actorRole: approval.actorRole, approvedAt: approval.approvedAt, endsAt: approval.endsAt },
      experiment: await this.getExperiment.execute(id, principal.tenantId) };
  }
}
