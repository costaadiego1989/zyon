import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
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
  ApiQuery,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { CursorPaginationHelper } from '../../../../../shared/http/pagination/cursor-pagination.helper.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import {
  ListOrdersUseCase,
  GetOrderUseCase,
} from '../../../../operations/application/operations-read.use-cases.js';
import {
  CancelOrderUseCase,
  UpdateOrderStatusUseCase,
} from '../../../../operations/application/order-command.use-cases.js';
import { OrderEntityMapper } from '../../application/mappers/order-entity.mapper.js';
import { CancelOrderDto, UpdateOrderTrackingDto } from './dtos/order.dtos.js';

/**
 * Public API v1 — Orders
 *
 * RESTful resource controller for order operations.
 * Delegates to existing OperationsModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags('Orders')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('orders')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class OrdersV1Controller {
  constructor(
    private readonly listOrdersUseCase: ListOrdersUseCase,
    private readonly getOrderUseCase: GetOrderUseCase,
    private readonly cancelOrderUseCase: CancelOrderUseCase,
    private readonly updateOrderStatusUseCase: UpdateOrderStatusUseCase,
  ) {}

  /**
   * GET /v1/orders
   * List orders with cursor-based pagination.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ['orders:read'] })
  @ApiOperation({ summary: 'List orders for merchant' })
  @ApiQuery({ name: 'limit', type: 'number', required: false, example: 20 })
  @ApiQuery({ name: 'cursor', type: 'string', required: false })
  @ApiOkResponse({ description: 'Orders list' })
  async list(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const pageSize = Math.min(limit ?? 20, 100);

    if (cursor) {
      const { valid, error } = CursorPaginationHelper.validateCursor(cursor);
      if (!valid) {
        throw new Error(`Invalid cursor: ${error}`);
      }
    }

    // ListOrdersUseCase.execute(input: PageInput) — single object
    const result = await this.listOrdersUseCase.execute({
      merchantId,
      limit: pageSize,
      cursor,
    });

    return CursorPaginationHelper.format(result, (order) =>
      OrderEntityMapper.toOrderSummaryResponse(order),
    );
  }

  /**
   * GET /v1/orders/:orderId
   * Get a single order with full details.
   */
  @Get(':orderId')
  @RequireTenantAccess({ serviceScopes: ['orders:read'] })
  @ApiOperation({ summary: 'Get order details' })
  @ApiOkResponse({ description: 'Order details' })
  async get(@Req() req: any, @Param('orderId') orderId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const order = await this.getOrderUseCase.execute(merchantId, orderId);
    return OrderEntityMapper.toOrderDetailResponse(order);
  }

  /**
   * POST /v1/orders/:orderId/cancel
   * Cancel an order.
   */
  @Post(':orderId/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['orders:write'] })
  @ApiOperation({ summary: 'Cancel an order' })
  @ApiOkResponse({ description: 'Order cancelled' })
  async cancel(@Req() req: any, @Param('orderId') orderId: string, @Body() body: CancelOrderDto) {
    const merchantId = req.tenantPrincipal?.tenantId;
    // CancelOrderUseCase.execute(input: { merchantId, orderId, reason, ... })
    const result = await this.cancelOrderUseCase.execute({
      merchantId,
      orderId,
      reason: body.reason ?? 'Cancelled via API',
      notifyCustomer: body.notify_customer,
      restock: body.restock,
    });
    return OrderEntityMapper.toCancelOrderResponse(result);
  }

  /**
   * GET /v1/orders/:orderId/tracking
   * Get order tracking information.
   */
  @Get(':orderId/tracking')
  @RequireTenantAccess({ serviceScopes: ['tracking:read'] })
  @ApiOperation({ summary: 'Get order tracking' })
  @ApiOkResponse({ description: 'Tracking information' })
  async getTracking(@Req() req: any, @Param('orderId') orderId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const order = await this.getOrderUseCase.execute(merchantId, orderId);
    return OrderEntityMapper.toTrackingResponse(order);
  }

  /**
   * PATCH /v1/orders/:orderId/tracking
   * Update order tracking / status.
   */
  @Patch(':orderId/tracking')
  @Idempotent()
  @RequireTenantAccess({ serviceScopes: ['tracking:write'] })
  @ApiOperation({ summary: 'Update order tracking' })
  @ApiOkResponse({ description: 'Tracking updated' })
  async updateTracking(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @Body() body: UpdateOrderTrackingDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;
    // UpdateOrderStatusUseCase.execute(input: { merchantId, orderId, status })
    const result = await this.updateOrderStatusUseCase.execute({
      merchantId,
      orderId,
      status: body.status,
    });
    return OrderEntityMapper.toUpdateTrackingResponse(result);
  }
}
