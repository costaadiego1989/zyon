import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { CursorPaginationHelper } from '../../../../../shared/http/pagination/cursor-pagination.helper.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { RequestReturnUseCase } from '../../../../returns/application/use-cases/request-return.use-case.js';
import { ListReturnsUseCase } from '../../../../returns/application/use-cases/list-returns.use-case.js';
import { ReturnEntityMapper } from '../../application/mappers/return-entity.mapper.js';
import { RequestReturnDto } from './dtos/return.dtos.js';

@ApiTags('Returns')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('returns')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class ReturnsV1Controller {
  constructor(
    private readonly requestReturnUseCase: RequestReturnUseCase,
    private readonly listReturnsUseCase: ListReturnsUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['returns:read'] })
  @ApiOperation({ summary: 'List returns for merchant' })
  @ApiQuery({ name: 'limit', type: 'number', required: false, example: 20 })
  @ApiQuery({ name: 'cursor', type: 'string', required: false })
  @ApiQuery({ name: 'status', type: 'string', required: false })
  @ApiOkResponse({ description: 'Returns list' })
  async list(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
    @Query('status') status?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const pageSize = Math.min(limit ?? 20, 100);

    if (cursor) {
      const { valid, error } = CursorPaginationHelper.validateCursor(cursor);
      if (!valid) {
        throw new Error(`Invalid cursor: ${error}`);
      }
    }

    const result = await this.listReturnsUseCase.execute({
      merchantId,
      limit: pageSize,
      cursor,
      status: status as any,
    });

    return CursorPaginationHelper.format(
      { data: result.returns, nextCursor: result.nextCursor ?? null },
      (ret) => ReturnEntityMapper.toReturnResponse(ret),
    );
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['returns:write'] })
  @ApiOperation({ summary: 'Request a return for an order' })
  @ApiCreatedResponse({ description: 'Return request created' })
  async requestReturn(@Req() req: any, @Body() body: RequestReturnDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const buyerId = req.tenantPrincipal?.buyerId ?? req.user?.id;

    const result = await this.requestReturnUseCase.execute({
      merchantId,
      orderId: body.order_id,
      buyerId,
      reason: body.reason,
      notes: body.notes,
      items: body.items.map((item) => ({
        variantId: item.variant_id,
        quantity: item.quantity,
        reason: item.reason,
      })),
    });

    return ReturnEntityMapper.toReturnResponse(result);
  }
}
