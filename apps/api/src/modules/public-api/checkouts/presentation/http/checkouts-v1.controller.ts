import {
  Controller,
  Post,
  Get,
  Patch,
  Req,
  Param,
  Body,
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
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBody,
} from '@nestjs/swagger';
import type {
  StartCheckoutRequest,
  TrackEventRequest,
  ChatMessageRequest,
  ShippingEvaluateRequest,
  ApplyOfferRequest,
  CompleteOrderRequest,
  UpdateCartRequest,
} from '@zyon/shared-types';

import { ResponseEnvelopeInterceptor } from '../../../../../shared/http/response-envelope.interceptor.js';
import { Idempotent } from '../../../../../shared/http/idempotency/idempotent.decorator.js';
import { StartCheckoutUseCase } from '../../../../checkout/application/use-cases/start-checkout.use-case.js';
import { TrackCheckoutEventUseCase } from '../../../../checkout/application/use-cases/track-checkout-event.use-case.js';
import { GetCheckoutSessionUseCase } from '../../../../checkout/application/use-cases/get-checkout-session.use-case.js';
import { SendChatMessageUseCase } from '../../../../checkout/application/use-cases/send-chat-message.use-case.js';
import { EvaluateShippingUseCase } from '../../../../checkout/application/use-cases/evaluate-shipping.use-case.js';
import { ApplyOfferUseCase } from '../../../../checkout/application/use-cases/apply-offer.use-case.js';
import { CompleteOrderUseCase } from '../../../../checkout/application/use-cases/complete-order.use-case.js';
import { UpdateCartUseCase } from '../../../../checkout/application/use-cases/update-cart.use-case.js';
import { CheckoutEntityMapper } from '../../application/mappers/checkout-entity.mapper.js';
import {
  ApplyOfferDto,
  CompleteCheckoutDto,
  EvaluateShippingDto,
  SendCheckoutMessageDto,
  StartCheckoutDto,
  TrackCheckoutEventDto,
  UpdateCheckoutCartDto,
  StartCheckoutResponse,
  CheckoutSessionResponse,
  TrackEventResponse,
  ChatMessageResponse,
  ShippingEvaluateResponse,
  ApplyOfferResponse,
  CompleteOrderResponse,
  UpdateCartResponse,
} from './dtos/checkout.dtos.js';

/**
 * Public API v1 — Checkouts
 *
 * RESTful resource controller for AI-powered checkout sessions.
 * Delegates to existing use-cases; no business logic in this layer.
 *
 * Auth: Bearer API key (service) or session cookie (human/dashboard).
 * Tenant: Automatically scoped by global TenantGuard + TenantInterceptor.
 */
@ApiTags('Checkouts')
@ApiBearerAuth('service_api_key')
@ApiCookieAuth('console_session')
@Controller('checkouts')
@UseInterceptors(ResponseEnvelopeInterceptor)
export class CheckoutsV1Controller {
  constructor(
    private readonly startCheckoutUseCase: StartCheckoutUseCase,
    private readonly trackEventUseCase: TrackCheckoutEventUseCase,
    private readonly getCheckoutUseCase: GetCheckoutSessionUseCase,
    private readonly sendMessageUseCase: SendChatMessageUseCase,
    private readonly evaluateShippingUseCase: EvaluateShippingUseCase,
    private readonly applyOfferUseCase: ApplyOfferUseCase,
    private readonly completeOrderUseCase: CompleteOrderUseCase,
    private readonly updateCartUseCase: UpdateCartUseCase,
  ) {}

  /**
   * POST /v1/checkouts
   * Start a new AI-powered checkout session.
   */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a new checkout session' })
  @ApiBody({ type: StartCheckoutDto })
  @ApiCreatedResponse({ type: StartCheckoutResponse, description: 'Checkout session created' })
  async start(@Req() req: any, @Body() body: StartCheckoutDto) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const cartTotal = (body.cart ?? []).reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const input: StartCheckoutRequest = {
      merchant_id: merchantId as string,
      session_id: body.session_id,
      cart: {
        items: body.cart,
        currency: 'BRL',
        total: cartTotal,
      },
      customer: body.customer
        ? {
            email: body.customer.email,
            fullName: body.customer.full_name,
            phone: body.customer.phone,
            cpf: body.customer.cpf,
          }
        : undefined,
      cart_ref: body.cart_ref,
    };

    const result = await this.startCheckoutUseCase.execute(input);
    return CheckoutEntityMapper.toStartCheckoutResponse(result);
  }

  /**
   * GET /v1/checkouts/:checkoutId
   * Retrieve checkout session details.
   */
  @Get(':checkoutId')
  @ApiOperation({ summary: 'Get checkout session details' })
  @ApiOkResponse({ type: CheckoutSessionResponse, description: 'Checkout session details' })
  async get(@Req() req: any, @Param('checkoutId') checkoutId: string) {
    const merchantId = req.tenantPrincipal?.tenantId;
    const session = await this.getCheckoutUseCase.execute(merchantId, checkoutId);
    return CheckoutEntityMapper.toCheckoutSessionResponse(session);
  }

  /**
   * POST /v1/checkouts/:checkoutId/events
   * Track a user event in the checkout session (page_view, scroll, etc).
   */
  @Post(':checkoutId/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Track a checkout event' })
  @ApiBody({ type: TrackCheckoutEventDto })
  @ApiOkResponse({ type: TrackEventResponse, description: 'Event tracked' })
  async trackEvent(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: TrackCheckoutEventDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const input: TrackEventRequest = {
      merchant_id: merchantId,
      session_id: checkoutId,
      event: body.event,
      metadata: body.metadata,
    };

    const result = await this.trackEventUseCase.execute(input);
    return CheckoutEntityMapper.toTrackEventResponse(result);
  }

  /**
   * POST /v1/checkouts/:checkoutId/messages
   * Send a chat message to the AI agent.
   */
  @Post(':checkoutId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a chat message to AI agent' })
  @ApiBody({ type: SendCheckoutMessageDto })
  @ApiOkResponse({ type: ChatMessageResponse, description: 'Agent response' })
  async sendMessage(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: SendCheckoutMessageDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const input: ChatMessageRequest = {
      merchant_id: merchantId,
      session_id: checkoutId,
      conversation_id: body.conversation_id,
      user_message: body.user_message,
      agent_id: body.agent_id,
    };

    const result = await this.sendMessageUseCase.execute(input);
    return CheckoutEntityMapper.toChatMessageResponse(result);
  }

  /**
   * POST /v1/checkouts/:checkoutId/shipping/evaluate
   * Evaluate shipping offers (subsidies, free shipping eligibility).
   */
  @Post(':checkoutId/shipping/evaluate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Evaluate shipping options' })
  @ApiBody({ type: EvaluateShippingDto })
  @ApiOkResponse({ type: ShippingEvaluateResponse, description: 'Shipping evaluation result' })
  async evaluateShipping(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: EvaluateShippingDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const input: ShippingEvaluateRequest = {
      merchant_id: merchantId,
      session_id: checkoutId,
      cart_value: body.cart_value,
      shipping_price: body.shipping_price,
      shipping_real_cost: body.shipping_real_cost,
      abandonment_score: body.abandonment_score,
    };

    const result = await this.evaluateShippingUseCase.execute(input);
    return CheckoutEntityMapper.toShippingEvaluateResponse(result);
  }

  /**
   * POST /v1/checkouts/:checkoutId/offers
   * Apply an authorized offer to the checkout session.
   */
  @Post(':checkoutId/offers')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply an offer to checkout' })
  @ApiBody({ type: ApplyOfferDto })
  @ApiOkResponse({ type: ApplyOfferResponse, description: 'Offer applied' })
  async applyOffer(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: ApplyOfferDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const input: ApplyOfferRequest = {
      merchant_id: merchantId,
      session_id: checkoutId,
      offer_id: body.offer_id,
    };

    const result = await this.applyOfferUseCase.execute(input);
    return CheckoutEntityMapper.toApplyOfferResponse(result);
  }

  /**
   * POST /v1/checkouts/:checkoutId/complete
   * Complete the checkout and create an order.
   */
  @Post(':checkoutId/complete')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Complete checkout and create order' })
  @ApiBody({ type: CompleteCheckoutDto })
  @ApiCreatedResponse({ type: CompleteOrderResponse, description: 'Order created' })
  async complete(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: CompleteCheckoutDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const input: CompleteOrderRequest = {
      merchant_id: merchantId,
      session_id: checkoutId,
      external_order_id: body.external_order_id,
      order_total: body.order_total,
      currency: body.currency,
      accepted_offer_id: body.accepted_offer_id,
      tracking_code: body.tracking_code,
    };

    const result = await this.completeOrderUseCase.execute(input);
    return CheckoutEntityMapper.toCompleteOrderResponse(result);
  }

  /**
   * PATCH /v1/checkouts/:checkoutId/cart
   * Update the cart items in a checkout session.
   */
  @Patch(':checkoutId/cart')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update checkout cart' })
  @ApiBody({ type: UpdateCheckoutCartDto })
  @ApiOkResponse({ type: UpdateCartResponse, description: 'Cart updated' })
  async updateCart(
    @Req() req: any,
    @Param('checkoutId') checkoutId: string,
    @Body() body: UpdateCheckoutCartDto,
  ) {
    const merchantId = req.tenantPrincipal?.tenantId;

    const input: UpdateCartRequest = {
      merchant_id: merchantId,
      session_id: checkoutId,
      items: body.items,
    };

    const result = await this.updateCartUseCase.execute(input);
    return CheckoutEntityMapper.toUpdateCartResponse(result);
  }
}
