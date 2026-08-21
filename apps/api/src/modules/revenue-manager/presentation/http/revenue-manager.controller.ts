import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { ApproveHypothesisUseCase } from "../../application/use-cases/approve-hypothesis.use-case.js";
import { RejectHypothesisUseCase } from "../../application/use-cases/reject-hypothesis.use-case.js";
import { OBSERVATION_REPOSITORY_PORT, type ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";
import { HYPOTHESIS_REPOSITORY_PORT, type HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { STRATEGY_LESSON_REPOSITORY_PORT, type StrategyLessonRepositoryPort } from "../../domain/ports/strategy-lesson-repository.port.js";
import {
  ApproveHypothesisDto,
  RejectHypothesisDto,
  ObservationResponseDto,
  HypothesisResponseDto,
  StrategyLessonResponseDto,
  ApproveHypothesisResponseDto,
  RejectHypothesisResponseDto,
} from "./revenue-manager.dto.js";

@ApiTags("Revenue Manager")
@Controller("revenue-manager")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class RevenueManagerController {
  constructor(
    private readonly approveHypothesis: ApproveHypothesisUseCase,
    private readonly rejectHypothesis: RejectHypothesisUseCase,
    @Inject(OBSERVATION_REPOSITORY_PORT) private readonly observationRepo: ObservationRepositoryPort,
    @Inject(HYPOTHESIS_REPOSITORY_PORT) private readonly hypothesisRepo: HypothesisRepositoryPort,
    @Inject(STRATEGY_LESSON_REPOSITORY_PORT) private readonly lessonRepo: StrategyLessonRepositoryPort,
  ) {}

  // ===== Observations =====

  @Get("observations")
  @ApiOperation({ summary: "List observations for merchant" })
  @ApiOkResponse({ type: [ObservationResponseDto] })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async listObservations(@Req() req: any, @Query("limit") limit?: string): Promise<ObservationResponseDto[]> {
    const user = currentUser(req);
    const observations = await this.observationRepo.findByMerchant(user.merchantId, limit ? parseInt(limit, 10) : undefined);
    return observations.map((obs) => {
      const snap = obs.snapshot();
      return {
        id: snap.id,
        merchant_id: snap.merchant_id,
        observation_window_start: snap.observation_window_start,
        observation_window_end: snap.observation_window_end,
        funnel: snap.funnel,
        abandonment: snap.abandonment,
        objections: snap.objections,
        cross_sell: snap.cross_sell,
        current_experiment: snap.current_experiment,
        cohorts: snap.cohorts,
        revenue: snap.revenue,
        ai_costs_cents: snap.ai_costs_cents,
        created_at: snap.created_at,
      };
    });
  }

  // ===== Hypotheses =====

  @Get("hypotheses")
  @ApiOperation({ summary: "List hypotheses for merchant" })
  @ApiOkResponse({ type: [HypothesisResponseDto] })
  @ApiQuery({ name: "status", required: false, type: String })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async listHypotheses(
    @Req() req: any,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<HypothesisResponseDto[]> {
    const user = currentUser(req);
    const hypotheses = await this.hypothesisRepo.findByMerchant(user.merchantId, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return hypotheses.map((h) => {
      const snap = h.snapshot();
      return {
        id: snap.id,
        merchant_id: snap.merchant_id,
        observation_id: snap.observation_id,
        hypothesis_text: snap.hypothesis_text,
        reasoning: snap.reasoning,
        expected_lift_percent: snap.expected_lift_percent,
        risk_level: snap.risk_level,
        template: snap.template,
        status: snap.status,
        approval_strategy: snap.approval_strategy,
        merchant_approved_at: snap.merchant_approved_at,
        merchant_approved_by: snap.merchant_approved_by,
        merchant_approval_reason: snap.merchant_approval_reason,
        rejection_reason: snap.rejection_reason,
        created_experiment_id: snap.created_experiment_id,
        created_at: snap.created_at,
        updated_at: snap.updated_at,
      };
    });
  }

  // ===== Approve/Reject =====

  @Post("hypotheses/:id/approve")
  @ApiOperation({ summary: "Approve a pending hypothesis" })
  @ApiOkResponse({ type: ApproveHypothesisResponseDto })
  async approve(
    @Param("id") id: string,
    @Body() body: ApproveHypothesisDto,
    @Req() req: any,
  ): Promise<ApproveHypothesisResponseDto> {
    const user = currentUser(req);
    try {
      return await this.approveHypothesis.execute({
        hypothesis_id: id,
        merchant_id: user.merchantId,
        approved_by: body.approved_by,
        approval_reason: body.approval_reason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "HYPOTHESIS_NOT_FOUND") throw new NotFoundException("Hypothesis not found");
      if (msg === "HYPOTHESIS_NOT_PENDING_REVIEW") throw new BadRequestException("Hypothesis is not pending review");
      throw err;
    }
  }

  @Post("hypotheses/:id/reject")
  @ApiOperation({ summary: "Reject a pending hypothesis" })
  @ApiOkResponse({ type: RejectHypothesisResponseDto })
  async reject(
    @Param("id") id: string,
    @Body() body: RejectHypothesisDto,
    @Req() req: any,
  ): Promise<RejectHypothesisResponseDto> {
    const user = currentUser(req);
    if (!body.reason || body.reason.trim().length === 0) {
      throw new BadRequestException("Rejection reason is required");
    }
    try {
      return await this.rejectHypothesis.execute({
        hypothesis_id: id,
        merchant_id: user.merchantId,
        reason: body.reason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "HYPOTHESIS_NOT_FOUND") throw new NotFoundException("Hypothesis not found");
      if (msg === "HYPOTHESIS_NOT_PENDING_REVIEW") throw new BadRequestException("Hypothesis is not pending review");
      throw err;
    }
  }

  // ===== Strategy Lessons =====

  @Get("strategy-lessons")
  @ApiOperation({ summary: "List strategy lessons for merchant" })
  @ApiOkResponse({ type: [StrategyLessonResponseDto] })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async listStrategyLessons(@Req() req: any, @Query("limit") limit?: string): Promise<StrategyLessonResponseDto[]> {
    const user = currentUser(req);
    const lessons = await this.lessonRepo.findByMerchant(user.merchantId, limit ? parseInt(limit, 10) : undefined);
    return lessons.map((l) => {
      const snap = l.snapshot();
      return {
        id: snap.id,
        merchant_id: snap.merchant_id,
        experiment_id: snap.experiment_id,
        hypothesis_id: snap.hypothesis_id,
        hypothesis_text: snap.hypothesis_text,
        actual_winner: snap.actual_winner,
        hypothesis_was_correct: snap.hypothesis_was_correct,
        control_conversion_rate: snap.control_conversion_rate,
        challenger_conversion_rate: snap.challenger_conversion_rate,
        conversion_lift_percent: snap.conversion_lift_percent,
        sessions_per_variant: snap.sessions_per_variant,
        statistical_confidence: snap.statistical_confidence,
        insights: snap.insights,
        generator_feedback: snap.generator_feedback,
        recorded_at: snap.recorded_at,
      };
    });
  }
}
