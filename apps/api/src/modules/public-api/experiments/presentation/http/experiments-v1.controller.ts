import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBody,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { CreateExperimentUseCase } from '../../../../experiments/application/use-cases/create-experiment.use-case.js';
import { GetExperimentUseCase } from '../../../../experiments/application/use-cases/get-experiment.use-case.js';
import { ListExperimentsUseCase } from '../../../../experiments/application/use-cases/list-experiments.use-case.js';
import { UpdateExperimentUseCase } from '../../../../experiments/application/use-cases/update-experiment.use-case.js';
import { StartExperimentUseCase } from '../../../../experiments/application/use-cases/start-experiment.use-case.js';
import { StopExperimentUseCase } from '../../../../experiments/application/use-cases/stop-experiment.use-case.js';
import { ArchiveExperimentUseCase } from '../../../../experiments/application/use-cases/archive-experiment.use-case.js';
import { GetExperimentResultsUseCase } from '../../../../experiments/application/use-cases/get-experiment-results.use-case.js';
import { PromoteWinnerUseCase } from '../../../../experiments/application/use-cases/promote-winner.use-case.js';
import { ExperimentEntityMapper } from '../../application/mappers/experiment-entity.mapper.js';
import { CreateExperimentDto, UpdateExperimentDto, PromoteWinnerDto } from './dtos/experiment.dtos.js';
import {
  ExperimentSummaryResponse,
  ExperimentDetailResponse,
  ExperimentResultsResponse,
} from './dtos/experiment-response.dto.js';

@ApiTags('Experiments')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('experiments')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class ExperimentsV1Controller {
  constructor(
    private readonly createExperimentUseCase: CreateExperimentUseCase,
    private readonly getExperimentUseCase: GetExperimentUseCase,
    private readonly listExperimentsUseCase: ListExperimentsUseCase,
    private readonly updateExperimentUseCase: UpdateExperimentUseCase,
    private readonly startExperimentUseCase: StartExperimentUseCase,
    private readonly stopExperimentUseCase: StopExperimentUseCase,
    private readonly archiveExperimentUseCase: ArchiveExperimentUseCase,
    private readonly getExperimentResultsUseCase: GetExperimentResultsUseCase,
    private readonly promoteWinnerUseCase: PromoteWinnerUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['experiments:read'] })
  @ApiOperation({ summary: 'List experiments' })
  @ApiOkResponse({ description: 'Experiments list', type: [ExperimentSummaryResponse] })
  async list(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const experiments = await this.listExperimentsUseCase.execute(merchantId);
    return {
      data: experiments.map((e) => ExperimentEntityMapper.toExperimentSummaryResponse(e)),
      pagination: {
        total: experiments.length,
      },
    };
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['experiments:write'] })
  @ApiOperation({ summary: 'Create an experiment' })
  @ApiBody({ type: CreateExperimentDto })
  @ApiCreatedResponse({ description: 'Experiment created', type: ExperimentDetailResponse })
  async create(@Req() req: any, @Body() body: CreateExperimentDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const result = await this.createExperimentUseCase.execute({
      merchant_id: merchantId,
      name: body.name,
      description: body.description,
      variants: body.variants.map((v) => ({
        name: v.name,
        system_prompt: v.system_prompt,
        weight: v.weight,
        is_control: v.is_control,
      })),
    });

    const snapshot = await this.getExperimentUseCase.execute(result.experiment_id, merchantId);
    if (!snapshot) {
      return { experiment_id: result.experiment_id, status: result.status };
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }

  @Get(':experimentId')
  @RequireTenantAccess({ serviceScopes: ['experiments:read'] })
  @ApiOperation({ summary: 'Get experiment details' })
  @ApiOkResponse({ description: 'Experiment details', type: ExperimentDetailResponse })
  async get(@Req() req: any, @Param('experimentId') experimentId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const snapshot = await this.getExperimentUseCase.execute(experimentId, merchantId);
    if (!snapshot) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }

  @Patch(':experimentId')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['experiments:write'] })
  @ApiOperation({ summary: 'Update an experiment' })
  @ApiBody({ type: UpdateExperimentDto })
  @ApiOkResponse({ description: 'Experiment updated', type: ExperimentDetailResponse })
  async update(
    @Req() req: any,
    @Param('experimentId') experimentId: string,
    @Body() body: UpdateExperimentDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.updateExperimentUseCase.execute({
      merchant_id: merchantId,
      experiment_id: experimentId,
      name: body.name,
      description: body.description,
      variants: body.variants?.map((v) => ({
        id: v.id,
        name: v.name,
        system_prompt: v.system_prompt,
        weight: v.weight,
        is_control: v.is_control,
      })),
    });

    const snapshot = await this.getExperimentUseCase.execute(experimentId, merchantId);
    if (!snapshot) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }

  @Post(':experimentId/start')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['experiments:write'] })
  @ApiOperation({ summary: 'Start an experiment' })
  @ApiOkResponse({ description: 'Experiment started', type: ExperimentDetailResponse })
  async start(@Req() req: any, @Param('experimentId') experimentId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.startExperimentUseCase.execute({
      merchant_id: merchantId,
      experiment_id: experimentId,
    });

    const snapshot = await this.getExperimentUseCase.execute(experimentId, merchantId);
    if (!snapshot) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }

  @Post(':experimentId/stop')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['experiments:write'] })
  @ApiOperation({ summary: 'Stop an experiment' })
  @ApiOkResponse({ description: 'Experiment stopped', type: ExperimentDetailResponse })
  async stop(@Req() req: any, @Param('experimentId') experimentId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.stopExperimentUseCase.execute({
      merchant_id: merchantId,
      experiment_id: experimentId,
    });

    const snapshot = await this.getExperimentUseCase.execute(experimentId, merchantId);
    if (!snapshot) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }

  @Post(':experimentId/archive')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['experiments:write'] })
  @ApiOperation({ summary: 'Archive an experiment' })
  @ApiOkResponse({ description: 'Experiment archived', type: ExperimentDetailResponse })
  async archive(@Req() req: any, @Param('experimentId') experimentId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.archiveExperimentUseCase.execute({
      merchant_id: merchantId,
      experiment_id: experimentId,
    });

    const snapshot = await this.getExperimentUseCase.execute(experimentId, merchantId);
    if (!snapshot) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }

  @Get(':experimentId/results')
  @RequireTenantAccess({ serviceScopes: ['experiments:read'] })
  @ApiOperation({ summary: 'Get experiment results with significance metrics' })
  @ApiOkResponse({ description: 'Experiment results', type: ExperimentResultsResponse })
  async results(@Req() req: any, @Param('experimentId') experimentId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const results = await this.getExperimentResultsUseCase.execute(experimentId, merchantId);
    if (!results) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentResultsResponse(results);
  }

  @Post(':experimentId/promote')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['experiments:write'] })
  @ApiOperation({ summary: 'Promote a winning variant' })
  @ApiBody({ type: PromoteWinnerDto })
  @ApiOkResponse({ description: 'Winner promoted', type: ExperimentDetailResponse })
  async promote(
    @Req() req: any,
    @Param('experimentId') experimentId: string,
    @Body() body: PromoteWinnerDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    await this.promoteWinnerUseCase.execute(experimentId, merchantId, body.variant_id);

    const snapshot = await this.getExperimentUseCase.execute(experimentId, merchantId);
    if (!snapshot) {
      throw new NotFoundException('EXPERIMENT_NOT_FOUND');
    }
    return ExperimentEntityMapper.toExperimentDetailResponse(snapshot);
  }
}
