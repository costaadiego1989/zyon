import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ChangePlatformFeedbackTreatmentUseCase } from "../application/change-platform-feedback-treatment.use-case.js";
import { ListPlatformFeedbackUseCase } from "../application/list-platform-feedback.use-case.js";
import { PlatformAccessGuard } from "./platform-access.guard.js";
import { PlatformPermissionGuard } from "./platform-permission.guard.js";
import { RequirePlatformPermissions } from "./platform-permission.decorator.js";
import { throwPlatformFeedbackHttpError } from "./platform-feedback.http-errors.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@ApiTags("Platform Control Feedback")
@ApiBearerAuth("PlatformOperatorJWT")
@UseGuards(PlatformAccessGuard, PlatformPermissionGuard)
@Controller("platform/feedback")
export class PlatformFeedbackController {
  constructor(
    private readonly listFeedback: ListPlatformFeedbackUseCase,
    private readonly changeTreatment: ChangePlatformFeedbackTreatmentUseCase,
  ) {}

  @Get()
  @RequirePlatformPermissions("platform:feedback:read")
  @ApiOperation({ summary: "List merchant feedback for platform operators" })
  async list(
    @Query() query: { cursor?: string; limit?: string; status?: string; category?: string },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      return await this.listFeedback.execute(query, this.readAuditContext(request));
    } catch (error) {
      throwPlatformFeedbackHttpError(error);
    }
  }

  @Get(":id")
  @RequirePlatformPermissions("platform:feedback:read")
  @ApiOperation({ summary: "Get a merchant feedback item and its treatment state" })
  async detail(
    @Param("id") id: string,
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const feedback = await this.listFeedback.findById(id, this.readAuditContext(request));
      if (!feedback) throw new NotFoundException("platform_feedback_not_found");
      return feedback;
    } catch (error) {
      throwPlatformFeedbackHttpError(error);
    }
  }

  @Patch(":id/treatment")
  @RequirePlatformPermissions("platform:feedback:write")
  @ApiOperation({ summary: "Change feedback treatment with an internal note" })
  async treat(
    @Param("id") id: string,
    @Body() body: { status?: unknown; priority?: unknown; assigned_operator_id?: unknown; note?: unknown },
    @Req() request: PlatformPrincipalRequest & { correlationId?: string },
  ) {
    try {
      const principal = currentPlatformPrincipal(request);
      return await this.changeTreatment.execute({
        feedbackId: id,
        actorOperatorId: principal.operatorId,
        actorRole: principal.role,
        status: body.status,
        priority: body.priority,
        assignedOperatorId: body.assigned_operator_id,
        note: body.note,
        correlationId: request.correlationId ?? crypto.randomUUID(),
        environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
      });
    } catch (error) {
      throwPlatformFeedbackHttpError(error);
    }
  }

  private readAuditContext(request: PlatformPrincipalRequest & { correlationId?: string }) {
    const principal = currentPlatformPrincipal(request);
    return {
      actorOperatorId: principal.operatorId,
      correlationId: request.correlationId ?? crypto.randomUUID(),
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown",
    };
  }
}
