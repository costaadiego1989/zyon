import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard, currentUser } from "../../../auth/presentation/auth.guard.js";
import { CreateExperimentUseCase } from "../../application/use-cases/create-experiment.use-case.js";
import { GetExperimentUseCase } from "../../application/use-cases/get-experiment.use-case.js";
import { ListExperimentsUseCase } from "../../application/use-cases/list-experiments.use-case.js";
import { UpdateExperimentUseCase } from "../../application/use-cases/update-experiment.use-case.js";
import { StartExperimentUseCase } from "../../application/use-cases/start-experiment.use-case.js";
import { StopExperimentUseCase } from "../../application/use-cases/stop-experiment.use-case.js";
import { ArchiveExperimentUseCase } from "../../application/use-cases/archive-experiment.use-case.js";
import { PromoteWinnerUseCase } from "../../application/use-cases/promote-winner.use-case.js";
import { GetExperimentResultsUseCase } from "../../application/use-cases/get-experiment-results.use-case.js";
import {
  CreateExperimentRequestDto,
  UpdateExperimentRequestDto,
  ExperimentResponseDto,
  ExperimentResultsResponseDto,
  ExperimentListResponseDto,
} from "./experiments.dto.js";

@ApiTags("Experiments")
@Controller("experiments")
@UseGuards(AuthGuard)
@ApiBearerAuth("JWT")
export class ExperimentsController {
  constructor(
    private readonly createExperiment: CreateExperimentUseCase,
    private readonly getExperiment: GetExperimentUseCase,
    private readonly listExperiments: ListExperimentsUseCase,
    private readonly updateExperiment: UpdateExperimentUseCase,
    private readonly startExperiment: StartExperimentUseCase,
    private readonly stopExperiment: StopExperimentUseCase,
    private readonly archiveExperiment: ArchiveExperimentUseCase,
    private readonly promoteWinner: PromoteWinnerUseCase,
    private readonly getResults: GetExperimentResultsUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create new experiment" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  async create(
    @Req() req: any,
    @Body(ValidationPipe) body: CreateExperimentRequestDto,
  ): Promise<ExperimentResponseDto> {
    const user = currentUser(req);
    try {
      const output = await this.createExperiment.execute({
        merchant_id: user.merchantId,
        name: body.name,
        description: body.description,
        variants: body.variants,
      });
      const experiment = await this.getExperiment.execute(output.experiment_id, user.merchantId);
      if (!experiment) throw new Error("Failed to retrieve created experiment");
      return this.toResponse(experiment);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Get()
  @ApiOperation({ summary: "List all experiments" })
  @ApiOkResponse({ type: ExperimentListResponseDto })
  async list(@Req() req: any): Promise<ExperimentListResponseDto> {
    const user = currentUser(req);
    const experiments = await this.listExperiments.execute(user.merchantId);
    return {
      data: experiments.map((e) => this.toResponse(e)),
      total: experiments.length,
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get experiment details" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  @ApiNotFoundResponse({ description: "Experiment not found" })
  async get(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<ExperimentResponseDto> {
    const user = currentUser(req);
    const experiment = await this.getExperiment.execute(id, user.merchantId);
    if (!experiment) {
      throw new NotFoundException("experiment_not_found");
    }
    return this.toResponse(experiment);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update experiment (draft only)" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body(ValidationPipe) body: UpdateExperimentRequestDto,
  ): Promise<ExperimentResponseDto> {
    const user = currentUser(req);
    try {
      await this.updateExperiment.execute({
        experiment_id: id,
        merchant_id: user.merchantId,
        name: body.name,
        description: body.description,
        variants: body.variants,
      });
      const experiment = await this.getExperiment.execute(id, user.merchantId);
      if (!experiment) throw new Error("Failed to retrieve updated experiment");
      return this.toResponse(experiment);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Post(":id/start")
  @ApiOperation({ summary: "Start experiment" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  async start(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<ExperimentResponseDto> {
    const user = currentUser(req);
    try {
      await this.startExperiment.execute({ merchant_id: user.merchantId, experiment_id: id });
      const experiment = await this.getExperiment.execute(id, user.merchantId);
      if (!experiment) throw new Error("Failed to retrieve started experiment");
      return this.toResponse(experiment);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Post(":id/stop")
  @ApiOperation({ summary: "Stop experiment" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  async stop(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<ExperimentResponseDto> {
    const user = currentUser(req);
    try {
      await this.stopExperiment.execute({ merchant_id: user.merchantId, experiment_id: id });
      const experiment = await this.getExperiment.execute(id, user.merchantId);
      if (!experiment) throw new Error("Failed to retrieve stopped experiment");
      return this.toResponse(experiment);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Post(":id/archive")
  @ApiOperation({ summary: "Archive experiment" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  async archive(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<ExperimentResponseDto> {
    const user = currentUser(req);
    try {
      await this.archiveExperiment.execute({ merchant_id: user.merchantId, experiment_id: id });
      const experiment = await this.getExperiment.execute(id, user.merchantId);
      if (!experiment) throw new Error("Failed to retrieve archived experiment");
      return this.toResponse(experiment);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Post(":id/promote")
  @ApiOperation({ summary: "Promote winner variant" })
  @ApiOkResponse({ type: ExperimentResponseDto })
  async promote(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { variant_id: string },
  ): Promise<ExperimentResponseDto> {
    if (!body.variant_id) {
      throw new BadRequestException("variant_id_required");
    }
    const user = currentUser(req);
    try {
      await this.promoteWinner.execute(id, user.merchantId, body.variant_id);
      const experiment = await this.getExperiment.execute(id, user.merchantId);
      if (!experiment) throw new Error("Failed to retrieve experiment after promotion");
      return this.toResponse(experiment);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  @Get(":id/results")
  @ApiOperation({ summary: "Get experiment results" })
  @ApiOkResponse({ type: ExperimentResultsResponseDto })
  async results(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<ExperimentResultsResponseDto> {
    const user = currentUser(req);
    const output = await this.getResults.execute(id, user.merchantId);
    if (!output) {
      throw new NotFoundException("experiment_not_found");
    }
    return {
      experiment_id: output.experiment_id,
      experiment_name: output.variants[0]?.variant_name ?? "",
      status: output.status as any,
      variant_results: output.variants.map((v) => ({
        variant_id: v.variant_id,
        variant_name: v.variant_name,
        is_control: v.is_control,
        sessions: v.sample_size,
        conversions: v.conversions,
        conversion_rate: v.conversion_rate,
        revenue: v.total_revenue,
        avg_order_value: v.avg_revenue,
        offers_shown: 0,
        offers_accepted: 0,
        offer_acceptance_rate: 0,
      })),
      significance: null,
      total_sessions: output.variants.reduce((sum, v) => sum + v.sample_size, 0),
      total_conversions: output.variants.reduce((sum, v) => sum + v.conversions, 0),
      total_revenue: output.variants.reduce((sum, v) => sum + v.total_revenue, 0),
      started_at: output.started_at,
      completed_at: output.completed_at,
    };
  }

  private toResponse(snapshot: any): ExperimentResponseDto {
    return {
      id: snapshot.id,
      merchant_id: snapshot.merchant_id,
      name: snapshot.name,
      description: snapshot.description,
      status: snapshot.status,
      variants: snapshot.variants.map((v: any) => ({
        id: v.id,
        name: v.name,
        system_prompt: v.system_prompt,
        weight: v.weight,
        is_control: v.is_control,
      })),
      started_at: snapshot.started_at,
      completed_at: snapshot.completed_at,
      winner_variant_id: snapshot.winner_variant_id,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    };
  }
}
