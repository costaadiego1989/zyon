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
  ApiResponse,
} from '@nestjs/swagger';
import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { GetSupportSettingsUseCase } from '../../../../support/application/get-support-settings.use-case.js';
import { ListSupportTicketsUseCase } from '../../../../support/application/list-support-tickets.use-case.js';
import { SupportEntityMapper } from '../../application/mappers/support-entity.mapper.js';
import { SupportSettingsResponseDto, ListSupportTicketsResponseDto } from './dtos/support.dtos.js';

@ApiTags('Support')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
@Controller('support')
@UseInterceptors(ResponseEnvelopeInterceptor)
export class SupportV1Controller {
  constructor(
    private readonly getSupportSettings: GetSupportSettingsUseCase,
    private readonly listSupportTickets: ListSupportTicketsUseCase,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get support settings' })
  @ApiOkResponse({ description: 'Support settings retrieved', type: SupportSettingsResponseDto })
  @ApiResponse({ status: 403, description: 'Missing support:read scope' })
  @RequireTenantAccess({ serviceScopes: ['support:read'] })
  async getSettings(@Req() req: any): Promise<SupportSettingsResponseDto> {
    const merchantId = req.tenantPrincipal?.tenantId;
    const settings = await this.getSupportSettings.execute(merchantId);
    return SupportEntityMapper.toSettingsResponse(settings);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'List support tickets' })
  @ApiOkResponse({ description: 'Paginated list of support tickets', type: ListSupportTicketsResponseDto })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'in_progress', 'resolved', 'closed'] })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (1-200, default 50)' })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'Cursor for pagination' })
  @ApiResponse({ status: 400, description: 'Invalid status value' })
  @ApiResponse({ status: 403, description: 'Missing support:read scope' })
  @RequireTenantAccess({ serviceScopes: ['support:read'] })
  async listTickets(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ListSupportTicketsResponseDto> {
    const merchantId = req.tenantPrincipal?.tenantId;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const result = await this.listSupportTickets.execute(merchantId, status, parsedLimit, cursor);
    return SupportEntityMapper.toListTicketsResponse(result);
  }
}
