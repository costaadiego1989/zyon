import {
  Controller,
  Post,
  Body,
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
  ApiCreatedResponse,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { QuoteShippingUseCase } from '../../../../shipping/application/use-cases/quote-shipping.use-case.js';
import { ShippingEntityMapper } from '../../application/mappers/shipping-entity.mapper.js';
import { GetShippingQuotesDto, ShippingQuoteResponse } from './dtos/shipping.dtos.js';

/**
 * Public API v1 — Shipping
 *
 * RESTful resource controller for shipping quotes.
 * Delegates to existing ShippingQuotesModule use-cases.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags('Shipping')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('shipping')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class ShippingV1Controller {
  constructor(private readonly quoteShippingUseCase: QuoteShippingUseCase) {}

  /**
   * POST /v1/shipping/quotes
   * Get available shipping quotes for a cart.
   */
  @Post('quotes')
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['checkout:read'] })
  @ApiOperation({ summary: 'Get shipping quotes' })
  @ApiBody({ type: GetShippingQuotesDto })
  @ApiCreatedResponse({ description: 'Shipping quotes', type: ShippingQuoteResponse })
  async getQuotes(@Req() req: any, @Body() body: GetShippingQuotesDto) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const snapshot = await this.quoteShippingUseCase.execute({
      session_id: body.session_id,
      merchant_id: merchantId,
      destination_zip: body.destination_zip,
      cart_total: body.cart_total,
      origin_zip: body.origin_zip,
      packages: body.packages ? body.packages.map((p) => ({
        weightKg: p.weight_kg,
        heightCm: p.height_cm,
        widthCm: p.width_cm,
        lengthCm: p.length_cm,
        quantity: p.quantity,
      })) : undefined,
      items: body.items,
    });

    return ShippingEntityMapper.toShippingQuoteResponse(snapshot);
  }
}
