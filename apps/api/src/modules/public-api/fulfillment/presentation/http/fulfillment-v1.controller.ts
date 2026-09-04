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
  ApiBody,
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

import { CreateShipmentUseCase } from '../../../../fulfillment/application/use-cases/create-shipment.use-case.js';
import { ListShipmentsUseCase } from '../../../../fulfillment/application/use-cases/list-shipments.use-case.js';
import { FulfillmentEntityMapper } from '../../application/mappers/fulfillment-entity.mapper.js';
import { CreateShipmentDto, ShipmentSummaryResponse, CreateShipmentResponse } from './dtos/fulfillment.dtos.js';

/**
 * Public API v1 — Fulfillment
 *
 * RESTful resource controller for fulfillment (shipment) operations.
 * Delegates to FulfillmentModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags('Fulfillment')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('fulfillment/shipments')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class FulfillmentV1Controller {
  constructor(
    private readonly createShipmentUseCase: CreateShipmentUseCase,
    private readonly listShipmentsUseCase: ListShipmentsUseCase,
  ) {}

  /**
   * GET /v1/fulfillment/shipments
   * List shipments with cursor-based pagination.
   */
  @Get()
  @RequireTenantAccess({ serviceScopes: ['tracking:read'] })
  @ApiOperation({ summary: 'List shipments for merchant' })
  @ApiQuery({ name: 'limit', type: 'number', required: false, example: 20 })
  @ApiQuery({ name: 'cursor', type: 'string', required: false })
  @ApiQuery({ name: 'order_id', type: 'string', required: false })
  @ApiQuery({ name: 'status', type: 'string', required: false })
  @ApiOkResponse({ description: 'Shipments list', type: [ShipmentSummaryResponse] })
  async list(
    @Req() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
    @Query('order_id') orderId?: string,
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

    const result = await this.listShipmentsUseCase.execute({
      merchantId,
      limit: pageSize,
      cursor,
      orderId,
      status,
    });

    return CursorPaginationHelper.format(result, (shipment) =>
      FulfillmentEntityMapper.toShipmentSummaryResponse(shipment.snapshot()),
    );
  }

  /**
   * POST /v1/fulfillment/shipments
   * Create a new shipment for an order.
   */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['tracking:write'] })
  @ApiOperation({ summary: 'Create a shipment for an order' })
  @ApiBody({ type: CreateShipmentDto })
  @ApiCreatedResponse({ description: 'Shipment created', type: CreateShipmentResponse })
  async create(@Req() req: any, @Body() body: CreateShipmentDto) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const result = await this.createShipmentUseCase.execute({
      merchant_id: merchantId,
      order_id: body.order_id,
      carrier_key: body.carrier,
    });

    return FulfillmentEntityMapper.toCreateShipmentResponse(result);
  }
}
