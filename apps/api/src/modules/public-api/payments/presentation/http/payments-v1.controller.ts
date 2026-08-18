import {
  Controller,
  Get,
  Post,
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
  ApiCreatedResponse,
} from '@nestjs/swagger';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { TenantCredentialGuard } from '../../../../integrations/presentation/http/tenant-credential.guard.js';
import { TenantAccessGuard } from '../../../../integrations/presentation/http/tenant-access.guard.js';
import { RequireTenantAccess } from '../../../../integrations/presentation/http/tenant-access.decorator.js';

import { CreatePaymentIntentUseCase } from '../../../../payment/application/create-payment-intent.use-case.js';
import { GetPaymentIntentStatusUseCase } from '../../../../payment/application/get-payment-intent-status.use-case.js';
import { ConfirmStripePaymentUseCase } from '../../../../payment/application/confirm-stripe-payment.use-case.js';
import { PaymentEntityMapper } from '../../application/mappers/payment-entity.mapper.js';

/**
 * Public API v1 — Payments
 *
 * RESTful resource controller for payment intents.
 * Delegates to existing PaymentModule use-cases.
 */
@ApiTags('Payments')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('payments')
@UseInterceptors(ResponseEnvelopeInterceptor)
@UseGuards(TenantCredentialGuard, TenantAccessGuard)
export class PaymentsV1Controller {
  constructor(
    private readonly createPaymentIntent: CreatePaymentIntentUseCase,
    private readonly getPaymentStatus: GetPaymentIntentStatusUseCase,
    private readonly confirmStripe: ConfirmStripePaymentUseCase,
  ) {}

  /**
   * POST /v1/payments/intents
   * Create a payment intent for a checkout session.
   */
  @Post('intents')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Create a payment intent' })
  @ApiCreatedResponse({ description: 'Payment intent created' })
  async createIntent(@Req() req: any, @Body() body: any) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const result = await this.createPaymentIntent.execute({
      merchant_id: merchantId,
      session_id: body.session_id,
      idempotency_key: body.idempotency_key,
      method: body.method,
      accepted_offer_id: body.accepted_offer_id,
      credit_card: body.credit_card,
      remote_ip: req.ip,
    });

    return PaymentEntityMapper.toPaymentIntentResponse(result);
  }

  /**
   * GET /v1/payments/intents/:intentId
   * Get current status of a payment intent.
   */
  @Get('intents/:intentId')
  @RequireTenantAccess({ serviceScopes: ['payments:read'] })
  @ApiOperation({ summary: 'Get payment intent status' })
  @ApiOkResponse({ description: 'Payment status' })
  async getIntent(
    @Req() req: any,
    @Param('intentId') intentId: string,
    @Query('session_id') sessionId: string,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const result = await this.getPaymentStatus.execute({
      merchant_id: merchantId,
      session_id: sessionId,
      intent_id: intentId,
    });

    return PaymentEntityMapper.toPaymentStatusResponse(result);
  }

  /**
   * POST /v1/payments/intents/:intentId/confirm
   * Confirm a payment (Stripe client-side confirmation).
   */
  @Post('intents/:intentId/confirm')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequireTenantAccess({ serviceScopes: ['checkout:write'] })
  @ApiOperation({ summary: 'Confirm payment intent' })
  @ApiOkResponse({ description: 'Payment confirmed' })
  async confirmIntent(
    @Req() req: any,
    @Param('intentId') intentId: string,
    @Body() body: any,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const result = await this.confirmStripe.execute({
      merchant_id: merchantId,
      session_id: body.session_id,
      intent_id: intentId,
    });

    return PaymentEntityMapper.toConfirmPaymentResponse(result);
  }
}
