import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  BadRequestException,
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
import type { Cart } from '@zyon/shared-types';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { CreateCrossSellPromotionUseCase } from '../../../../cross-sell/application/use-cases/create-cross-sell-promotion.use-case.js';
import { ListEligibleCrossSellsUseCase } from '../../../../cross-sell/application/use-cases/list-eligible-cross-sells.use-case.js';
import { ListCrossSellPromotionsUseCase } from '../../../../cross-sell/application/use-cases/list-cross-sell-promotions.use-case.js';
import { CrossSellEntityMapper } from '../../application/mappers/cross-sell-entity.mapper.js';
import { CreateCrossSellDto, CrossSellPromotionResponse, CrossSellEligibleResponse } from './dtos/cross-sell.dtos.js';

@ApiTags('Cross-Sell')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('cross-sells')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class CrossSellV1Controller {
  constructor(
    private readonly createPromotionUseCase: CreateCrossSellPromotionUseCase,
    private readonly listPromotionsUseCase: ListCrossSellPromotionsUseCase,
    private readonly listEligibleUseCase: ListEligibleCrossSellsUseCase,
  ) {}

  @Get()
  @RequireTenantAccess({ serviceScopes: ['checkout:read'] })
  @ApiOperation({ summary: 'List cross-sell promotions' })
  @ApiOkResponse({ description: 'List of promotions', type: [CrossSellPromotionResponse] })
  async list(@Req() req: any) {
    const merchantId = req.tenantPrincipal?.tenantId as string;
    const promotions = await this.listPromotionsUseCase.execute(merchantId);
    return {
      data: promotions.map((p) => CrossSellEntityMapper.toPromotionResponse(p)),
    };
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['checkout:read'] })
  @ApiOperation({ summary: 'Create a cross-sell promotion' })
  @ApiBody({ type: CreateCrossSellDto })
  @ApiCreatedResponse({ description: 'Promotion created', type: CrossSellPromotionResponse })
  async create(@Req() req: any, @Body() body: CreateCrossSellDto) {
    const merchantId = req.tenantPrincipal?.tenantId as string;

    const promotion = await this.createPromotionUseCase.execute({
      merchant_id: merchantId,
      name: body.name,
      trigger: body.trigger,
      recommended_skus: body.recommended_skus,
      discount_percent: body.discount_percent,
      max_discount_percent: body.max_discount_percent,
      starts_at: new Date(body.starts_at),
      ends_at: body.ends_at ? new Date(body.ends_at) : undefined,
    });

    return CrossSellEntityMapper.toPromotionResponse(promotion);
  }

  @Get('eligible')
  @RequireTenantAccess({ serviceScopes: ['checkout:read'] })
  @ApiOperation({ summary: 'List eligible cross-sells for a checkout session' })
  @ApiQuery({ name: 'session_id', type: 'string', required: true })
  @ApiQuery({ name: 'cart', type: 'string', required: false, description: 'JSON-encoded cart object' })
  @ApiOkResponse({ description: 'Eligible cross-sell suggestions', type: [CrossSellEligibleResponse] })
  async listEligible(
    @Req() req: any,
    @Query('session_id') sessionId?: string,
    @Query('cart') cartJson?: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId as string;

    if (!sessionId) {
      throw new BadRequestException('session_id query parameter is required');
    }

    let cart: Cart;
    if (cartJson) {
      try {
        cart = JSON.parse(cartJson);
      } catch {
        throw new BadRequestException('Invalid cart JSON');
      }
    } else {
      cart = { currency: 'USD', total: 0, items: [] };
    }

    const suggestions = await this.listEligibleUseCase.execute({
      session_id: sessionId,
      merchant_id: merchantId,
      cart,
    });

    return {
      data: suggestions.map((s) => CrossSellEntityMapper.toEligibleResponse(s)),
    };
  }
}
