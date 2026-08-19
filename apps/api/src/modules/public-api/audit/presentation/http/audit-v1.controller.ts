import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiQuery,
  ApiInternalServerErrorResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { ListAuditEventsUseCase } from '../../../../audit/application/audit.use-cases.js';
import { InvalidCursorError } from '../../../../audit/domain/errors/invalid-cursor.error.js';
import { AuditEntityMapper } from '../../application/mappers/audit-entity.mapper.js';
import {
  ListAuditEventsQueryDto,
  ListAuditEventsResponse,
} from './dtos/audit.dtos.js';

@ApiTags('Audit')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('audit-events')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class AuditV1Controller {
  constructor(private readonly listAuditEvents: ListAuditEventsUseCase) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['audit:read'] })
  @ApiOperation({ summary: 'List audit events' })
  @ApiQuery({ name: 'action', required: false, example: 'checkout_created' })
  @ApiQuery({ name: 'resource_type', required: false, example: 'checkout' })
  @ApiQuery({ name: 'actor_id', required: false, example: 'usr_123' })
  @ApiQuery({ name: 'date_from', required: false, example: '2024-08-01' })
  @ApiQuery({ name: 'date_to', required: false, example: '2024-08-31' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    example: 50,
    description: 'Items per page (1-100, default 50)',
  })
  @ApiOkResponse({
    description: 'List of audit events with pagination',
    type: ListAuditEventsResponse,
  })
  @ApiBadRequestResponse({ description: 'Invalid cursor or query parameters' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error' })
  async listEvents(
    @Req() req: any,
    @Query() query: ListAuditEventsQueryDto,
  ): Promise<ListAuditEventsResponse> {
    const merchantId = req.tenantPrincipal?.tenantId;

    try {
      const result = await this.listAuditEvents.execute({
        merchantId,
        limit: query.limit ? Number(query.limit) : undefined,
        cursor: query.cursor,
        action: query.action,
        resourceType: query.resource_type,
        actorId: query.actor_id,
        since: query.date_from,
        until: query.date_to,
      });

      return AuditEntityMapper.toListResponse(result.data, result.nextCursor);
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw error;
      }
      throw error;
    }
  }
}
