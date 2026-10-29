import { Controller, Get, Post, Body, Query, Res, HttpStatus, HttpCode, Inject, Optional, Logger, BadRequestException, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiBody, ApiCreatedResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Cart, CartItem, StartCheckoutRequest } from '@zyon/shared-types';
import { GetAgentRulesUseCase } from '../../agent-rules/application/agent-rules.use-cases.js';
import { StartCheckoutUseCase } from '../../checkout/application/use-cases/start-checkout.use-case.js';
import { PRODUCT_VARIANT_LOOKUP_PORT, type ProductVariantLookupPort } from '../../checkout/domain/ports/product-variant-lookup.port.js';
import { PublicRoute } from '../../../shared/tenant/tenant.guard.js';
import { ProductFeedService, type FeedFormat } from './product-feed.service.js';
import { CheckoutSessionMapper, type AcpCheckoutSession } from './checkout-session.mapper.js';
import { AcpCheckoutLifecycleService, type CompleteSessionBody, type UpdateSessionBody } from './acp-checkout-lifecycle.service.js';
import { AcpBearerGuard, RequireAcpScopes } from './acp-bearer.guard.js';
import type { EmbedTokenClaims } from '../../embed/domain/embed-token.service.js';
import {
  CreateCheckoutSessionDto,
  UpdateCheckoutSessionDto,
  CompleteCheckoutSessionDto,
  CompleteCheckoutSessionResponseDto,
  AgentCardDto,
} from './agentic-protocol.dtos.js';

type AcpRequest = { acpClaims?: EmbedTokenClaims };

const AACP_CARD_VERSION = '1.0';
const AACP_PLATFORM_NAME = 'AACP Checkout Agent';
const AACP_PLATFORM_DESCRIPTION =
  'Negotiates discounts, shipping, and completes checkouts';

const CAPABILITY_DEFINITIONS: ReadonlyArray<{
  name: string;
  description: string;
  scopes: ReadonlyArray<string>;
}> = [
  {
    name: 'checkout',
    description: 'Complete checkout with items, shipping, payment',
    scopes: ['checkout:start', 'checkout:track', 'checkout:complete'],
  },
  {
    name: 'offers',
    description: 'Apply discounts and coupons',
    scopes: ['offers:apply', 'coupons:apply'],
  },
  {
    name: 'payment',
    description: 'Create and confirm payments',
    scopes: [
      'payment:intents:create',
      'payment:intents:confirm',
      'payment:intents:read',
    ],
  },
  {
    name: 'post-sale',
    description: 'Schedule delivery, request reviews, send win-back',
    scopes: [
      'post-sale:schedule',
      'post-sale:review',
      'post-sale:win-back',
    ],
  },
];

@ApiTags('Agentic Protocol')
@Controller('acp')
export class AgenticProtocolController {
  private readonly logger = new Logger(AgenticProtocolController.name);

  constructor(
    private readonly getAgentRules: GetAgentRulesUseCase,
    private readonly feedService: ProductFeedService,
    private readonly startCheckout: StartCheckoutUseCase,
    private readonly lifecycle: AcpCheckoutLifecycleService,
    @Optional() @Inject(PRODUCT_VARIANT_LOOKUP_PORT) private readonly variantLookup?: ProductVariantLookupPort,
  ) {}

  /**
   * GET /v1/acp/agent-card
   *
   * Publishes the A2A-style agent identity card describing capabilities,
   * scopes, and endpoints. Public — no auth required. Tenant-scoped via the
   * `merchant_id` query parameter; each merchant has its own agent_id.
   */
  @Get('agent-card')
  @ApiOperation({
    summary: 'Retrieve the AACP agent card',
    description:
      'Returns the A2A-style agent identity card with capabilities, scopes, ' +
      'and protocol endpoints. Tenant-scoped via the merchant_id query param.',
  })
  @ApiQuery({
    name: 'merchant_id',
    required: false,
    description:
      'Merchant identifier. When omitted, the card reflects the platform default agent.',
  })
  @ApiOkResponse({
    description: 'Agent card published',
    schema: {
      type: 'object',
      properties: {
        version: { type: 'string', example: '1.0' },
        agent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            avatar_url: { type: 'string', nullable: true },
          },
        },
        capabilities: { type: 'array' },
        endpoints: { type: 'object' },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getAgentCard(
    @Query('merchant_id') merchantId?: string,
  ): Promise<AgentCardDto> {
    const resolvedMerchantId =
      merchantId && merchantId.trim().length > 0
        ? merchantId.trim()
        : 'platform-default';

    let agentName = AACP_PLATFORM_NAME;
    try {
      const rules = await this.getAgentRules.execute({
        merchantId: resolvedMerchantId,
      });
      if (rules.identity?.agentName) agentName = rules.identity.agentName;
    } catch {
      // No rules configured yet — fall back to platform defaults.
    }

    return {
      version: AACP_CARD_VERSION,
      agent: {
        id: `aacp-merchant-agent-${resolvedMerchantId}`,
        name: agentName,
        description: AACP_PLATFORM_DESCRIPTION,
      },
      capabilities: CAPABILITY_DEFINITIONS.map((cap) => ({
        name: cap.name,
        description: cap.description,
        scopes: [...cap.scopes],
      })),
      endpoints: {
        checkout_sessions: '/v1/acp/checkout_sessions',
        products_feed: '/v1/acp/products/feed',
        webhooks: '/v1/acp/webhooks',
      },
      created_at: new Date().toISOString(),
    };
  }

  @Get('products/feed')
  @PublicRoute()
  @ApiOperation({
    summary: 'Export product feed (Google Merchant Format)',
    description:
      'Stream the merchant catalog as CSV or newline-delimited JSON ' +
      'in Google Merchant Feed canonical format. ' +
      'Public — no auth required. Paginated, cursor-based, tenant-scoped.',
  })
  @ApiQuery({
    name: 'merchant_id',
    required: false,
    description: 'Merchant to export (defaults to platform default)',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['csv', 'json'],
    description: 'Output format: "csv" (default, RFC 4180) or "json" (ndjson)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Rows per page, 1-5000, default 1000',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination — pass the X-Feed-Next-Cursor from prior response',
  })
  @ApiOkResponse({
    description: 'Product feed stream',
    content: {
      'text/csv': { schema: { type: 'string' } },
      'application/x-ndjson': { schema: { type: 'string' } },
    },
  })
  @PublicRoute()
  async feedExport(
    @Query('merchant_id') merchantId?: string,
    @Query('format') format?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Res() res?: Response,
  ): Promise<void> {
    if (!res) return;

    const resolvedMerchantId =
      merchantId && merchantId.trim().length > 0
        ? merchantId.trim()
        : 'merchant_default';

    const parsedLimit = limit ? Math.max(1, parseInt(limit, 10)) : undefined;
    const feedFormat = (format === 'json' ? 'json' : 'csv') as FeedFormat;

    const result = await this.feedService.stream({
      merchantId: resolvedMerchantId,
      format: feedFormat,
      limit: parsedLimit,
      cursor,
    });

    res.statusCode = HttpStatus.OK;
    res.contentType(result.contentType);
    res.setHeader('X-Feed-Total', result.pagination.rowsTotal.toString());
    res.setHeader('X-Feed-Has-More', result.pagination.hasMore ? 'true' : 'false');
    if (result.pagination.nextCursor) {
      res.setHeader('X-Feed-Next-Cursor', result.pagination.nextCursor);
    }

    result.stream.pipe(res);
  }

  /**
   * POST /v1/acp/checkout_sessions
   *
   * Create a new ACP checkout session. The agent sends `{ merchant_id, items[] }`
   * and the server is the price authority — each SKU is resolved via the catalog
   * to fetch authoritative price and name. The resulting AACP session is mapped
   * to the canonical ACP shape (cents, lowercased currency, ACP status enum).
   *
   * Public — no auth required. Tenant-scoped by `merchant_id` in the body.
   */
  @Post('checkout_sessions')
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an ACP checkout session',
    description:
      'Public endpoint used by buyer-side AI agents to start a checkout session. ' +
      'Reuses the AACP StartCheckoutUseCase and returns the canonical ACP shape.',
  })
  @ApiBody({ type: CreateCheckoutSessionDto })
  @ApiCreatedResponse({
    description: 'Checkout session created',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'not_ready_for_payment',
            'ready_for_payment',
            'completed',
            'canceled',
          ],
        },
        currency: { type: 'string', example: 'brl' },
        line_items: { type: 'array' },
        fulfillment_options: { type: 'array' },
        totals: { type: 'array' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  async createCheckoutSession(
    @Body() body: CreateCheckoutSessionDto,
  ): Promise<AcpCheckoutSession> {
    const merchantId = body.merchant_id?.trim();
    if (!merchantId) {
      throw new BadRequestException('acp_merchant_id_required');
    }
    if (!body.items || body.items.length === 0) {
      throw new BadRequestException('acp_items_required');
    }

    const cartItems: CartItem[] = [];
    let currency: Cart['currency'] = 'BRL';

    for (const requested of body.items) {
      const sku = requested.id?.trim();
      if (!sku) {
        throw new BadRequestException('acp_item_id_required');
      }
      const quantity = Math.floor(requested.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new BadRequestException('acp_item_quantity_invalid');
      }

      let name: string | undefined;
      let priceMajor: number | undefined;

      if (this.variantLookup) {
        const variant = await this.variantLookup.findBySku(merchantId, sku);
        if (!variant || variant.price == null) {
          throw new BadRequestException(`acp_sku_not_found:${sku}`);
        }
        priceMajor = variant.price;
        name = variant.name;
      } else {
        throw new BadRequestException('acp_catalog_unavailable');
      }

      cartItems.push({
        sku,
        name: name ?? sku,
        price: priceMajor,
        quantity,
      });
    }

    const cartTotal = Math.round(
      cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100,
    ) / 100;

    const cart: Cart = {
      currency,
      total: cartTotal,
      items: cartItems,
      source: 'platform_api',
    };

    const customer = body.buyer?.email
      ? { email: body.buyer.email }
      : undefined;

    const startRequest: StartCheckoutRequest = {
      merchant_id: merchantId,
      cart,
      customer,
    };

    try {
      const result = await this.startCheckout.execute(startRequest);

      const session = {
        merchantId,
        sessionId: result.session_id,
        globalUserId: result.global_user_id,
        conversationId: result.conversation_id,
        cart,
        customer,
        abandonmentScore: 0,
        triggerAgent: result.agent_enabled,
        chatHistory: result.turns ?? [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return CheckoutSessionMapper.toAcp({
        session,
        aacpStatus: 'pending',
      });
    } catch (error) {
      this.logger.error(
        `acp_create_checkout_failed merchant=${merchantId} err=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * GET /v1/acp/checkout_sessions/:id
   *
   * Returns the canonical ACP session shape. Public — no auth required.
   * Tenant-scoped by `merchant_id` in the body or query.
   */
  @Get('checkout_sessions/:id')
  @PublicRoute()
  @ApiOperation({
    summary: 'Get an ACP checkout session',
    description:
      'Returns the canonical ACP checkout session shape (status, totals, line items, fulfillment options).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { merchant_id: { type: 'string', example: 'mrc_123' } },
      required: ['merchant_id'],
    },
  })
  @ApiOkResponse({ description: 'Canonical ACP checkout session shape' })
  async getCheckoutSession(
    @Param('id') id: string,
    @Body() body: { merchant_id?: string },
  ): Promise<AcpCheckoutSession> {
    const merchantId = body?.merchant_id?.trim();
    if (!merchantId) throw new BadRequestException('acp_merchant_id_required');
    return this.lifecycle.getSession(merchantId, id);
  }

  /**
   * POST /v1/acp/checkout_sessions/:id
   *
   * Update an existing ACP checkout session: line items, fulfillment option,
   * coupon code, buyer info, fulfillment address. Public — no auth required.
   * Terminal sessions (completed/canceled) cannot be mutated.
   */
  @Post('checkout_sessions/:id')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an ACP checkout session',
    description:
      'Mutates line items, fulfillment option, coupon code, buyer info or fulfillment address. ' +
      'Returns the refreshed canonical ACP session shape. Terminal sessions are immutable.',
  })
  @ApiBody({ type: UpdateCheckoutSessionDto })
  @ApiOkResponse({ description: 'Updated ACP checkout session' })
  async updateCheckoutSession(
    @Param('id') id: string,
    @Body() body: UpdateCheckoutSessionDto,
  ): Promise<AcpCheckoutSession> {
    const merchantId = body.merchant_id?.trim();
    if (!merchantId) throw new BadRequestException('acp_merchant_id_required');

    const updateBody: UpdateSessionBody = {
      fulfillment_option_id: body.fulfillment_option_id,
      line_items: body.line_items,
      coupon_code: body.coupon_code,
      buyer: body.buyer
        ? {
            email: body.buyer.email,
            full_name: body.buyer.full_name,
            phone: body.buyer.phone,
            cpf: body.buyer.cpf,
          }
        : undefined,
      fulfillment_address: body.fulfillment_address
        ? {
            name: body.fulfillment_address.name,
            line_one: body.fulfillment_address.line_one,
            line_two: body.fulfillment_address.line_two,
            city: body.fulfillment_address.city,
            state: body.fulfillment_address.state,
            country: body.fulfillment_address.country,
            postal_code: body.fulfillment_address.postal_code,
          }
        : undefined,
    };

    return this.lifecycle.updateSession(merchantId, id, updateBody);
  }

  /**
   * POST /v1/acp/checkout_sessions/:id/cancel
   *
   * Mark an ACP checkout session as canceled. Records a checkout_abandoned
   * event and neutralizes the cart so any subsequent complete attempt fails
   * pre-check. Public — no auth required.
   */
  @Post('checkout_sessions/:id/cancel')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an ACP checkout session',
    description:
      'Marks the session as canceled. The session is finalized; subsequent updates will be rejected.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { merchant_id: { type: 'string', example: 'mrc_123' } },
      required: ['merchant_id'],
    },
  })
  @ApiOkResponse({ description: 'Cancelled ACP checkout session' })
  async cancelCheckoutSession(
    @Param('id') id: string,
    @Body() body: { merchant_id?: string },
  ): Promise<AcpCheckoutSession> {
    const merchantId = body?.merchant_id?.trim();
    if (!merchantId) throw new BadRequestException('acp_merchant_id_required');
    return this.lifecycle.cancelSession(merchantId, id);
  }

  /**
   * POST /v1/acp/checkout_sessions/:id/complete
   *
   * Finalize the checkout by creating a payment intent and confirming the
   * order. Requires a valid AACP embed token with the `payment:intents:confirm`
   * scope. Returns the order id, confirmation URL, and the final session shape.
   */
  @Post('checkout_sessions/:id/complete')
  @UseGuards(AcpBearerGuard)
  @RequireAcpScopes(['payment:intents:confirm'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete an ACP checkout session',
    description:
      'Creates a payment intent via CreatePaymentIntentUseCase (PSP selected from merchant config: Stripe / Asaas / MercadoPago / Crypto), ' +
      'then commits the order via CompleteOrderUseCase. Requires a valid AACP embed token with `payment:intents:confirm` scope.',
  })
  @ApiBody({ type: CompleteCheckoutSessionDto })
  @ApiOkResponse({
    description: 'Checkout completed',
    type: CompleteCheckoutSessionResponseDto,
  })
  async completeCheckoutSession(
    @Param('id') id: string,
    @Req() req: AcpRequest,
    @Body() body: CompleteCheckoutSessionDto,
  ): Promise<CompleteCheckoutSessionResponseDto> {
    const claims = req.acpClaims;
    if (!claims) {
      throw new BadRequestException('acp_bearer_claims_missing');
    }

    const merchantId = body.merchant_id?.trim();
    if (!merchantId) throw new BadRequestException('acp_merchant_id_required');

    const completeBody: CompleteSessionBody = {
      payment_token: body.payment_token,
      payment_method: body.payment_method,
      idempotency_key: body.idempotency_key,
      buyer_email: body.buyer_email,
      accepted_offer_id: body.accepted_offer_id,
    };

    return this.lifecycle.completeSession(merchantId, id, claims, completeBody);
  }
}
