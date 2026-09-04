import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CheckoutEventName,
  CurrencyCode,
} from '@zyon/shared-types';

/**
 * Cart item input (v1 wire format).
 * `price` is expressed in minor units (cents).
 */
export class CartItemInputDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiProperty({ example: 'Product Name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    example: 4990,
    description: 'Price in minor units (cents)',
  })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/p/SKU-001.jpg',
  })
  @IsOptional()
  @IsString()
  image_url?: string;
}

/**
 * Customer hints supplied at session start.
 * All fields optional — downstream enrichment may fill the rest.
 */
export class CustomerInputDto {
  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  full_name?: string;

  @ApiPropertyOptional({ example: '+5511999999999' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '123.456.789-00' })
  @IsOptional()
  @IsString()
  cpf?: string;
}

/**
 * POST /v1/checkouts — Start a new checkout session.
 * `merchant_id` is injected from tenant principal, not accepted from the body.
 */
export class StartCheckoutDto {
  @ApiPropertyOptional({ example: 'sess_abc123' })
  @IsOptional()
  @IsString()
  session_id?: string;

  @ApiPropertyOptional({ example: 'cart_ref_xyz' })
  @IsOptional()
  @IsString()
  cart_ref?: string;

  @ApiProperty({ type: [CartItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemInputDto)
  cart!: CartItemInputDto[];

  @ApiPropertyOptional({ type: CustomerInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerInputDto)
  customer?: CustomerInputDto;

  // Note: `shipping` is not modeled here as it is not yet part of the
  // documented v1 contract; the controller safely forwards it from the
  // raw body when present.
}

/**
 * POST /v1/checkouts/:id/events — Track a checkout event.
 */
export class TrackCheckoutEventDto {
  @ApiProperty({
    example: 'checkout_started',
    enum: [
      'checkout_started',
      'cart_viewed',
      'shipping_calculated',
      'shipping_option_selected',
      'shipping_objection_detected',
      'coupon_field_clicked',
      'payment_method_selected',
      'payment_failed',
      'exit_intent_detected',
      'idle_30_seconds',
      'offer_viewed',
      'offer_accepted',
      'order_completed',
      'checkout_abandoned',
    ],
  })
  @IsString()
  @IsNotEmpty()
  event!: CheckoutEventName;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { referrer: 'google', path: '/cart' },
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * POST /v1/checkouts/:id/messages — Send a chat message to the AI agent.
 */
export class SendCheckoutMessageDto {
  @ApiProperty({ example: 'conv_xyz789' })
  @IsString()
  @IsNotEmpty()
  conversation_id!: string;

  @ApiProperty({ example: 'Can I get a discount?' })
  @IsString()
  @IsNotEmpty()
  user_message!: string;

  @ApiPropertyOptional({ example: 'agent_default' })
  @IsOptional()
  @IsString()
  agent_id?: string;
}

/**
 * POST /v1/checkouts/:id/shipping/evaluate — Evaluate shipping options.
 * All numeric fields are optional; missing values are interpreted by the
 * downstream use-case using its own defaults.
 */
export class EvaluateShippingDto {
  @ApiPropertyOptional({ example: 15000 })
  @IsOptional()
  @IsNumber()
  cart_value?: number;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @IsNumber()
  shipping_price?: number;

  @ApiPropertyOptional({ example: 1800 })
  @IsOptional()
  @IsNumber()
  shipping_real_cost?: number;

  @ApiPropertyOptional({
    example: 0.75,
    description: 'Score in [0, 1]; controller does not clamp',
  })
  @IsOptional()
  @IsNumber()
  abandonment_score?: number;
}

/**
 * POST /v1/checkouts/:id/offers — Apply an offer to the checkout.
 */
export class ApplyOfferDto {
  @ApiProperty({ example: 'offer_abc123' })
  @IsString()
  @IsNotEmpty()
  offer_id!: string;
}

/**
 * POST /v1/checkouts/:id/complete — Complete checkout and create an order.
 */
export class CompleteCheckoutDto {
  @ApiProperty({ example: 'order_12345' })
  @IsString()
  @IsNotEmpty()
  external_order_id!: string;

  @ApiProperty({ example: 14990, description: 'Order total in minor units' })
  @IsNumber()
  @Min(0)
  order_total!: number;

  @ApiProperty({ example: 'BRL', enum: ['BRL', 'USD', 'EUR'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['BRL', 'USD', 'EUR'])
  currency!: CurrencyCode;

  @ApiPropertyOptional({ example: 'offer_abc123' })
  @IsOptional()
  @IsString()
  accepted_offer_id?: string;

  @ApiPropertyOptional({ example: 'BR123456789' })
  @IsOptional()
  @IsString()
  tracking_code?: string;
}

/**
 * PATCH /v1/checkouts/:id/cart — Cart update item.
 */
export class UpdateCartItemDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @ApiProperty({ example: 3 })
  @IsNumber()
  @Min(0)
  quantity!: number;
}

/**
 * PATCH /v1/checkouts/:id/cart — Cart update payload.
 */
export class UpdateCheckoutCartDto {
  @ApiProperty({ type: [UpdateCartItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCartItemDto)
  items!: UpdateCartItemDto[];
}

// Response DTOs

export class CheckoutCartItemResponse {
  @ApiProperty({ example: 'SKU-001' })
  sku!: string;

  @ApiProperty({ example: 'Product Name' })
  name!: string;

  @ApiProperty({ example: 2 })
  quantity!: number;

  @ApiProperty({ example: 4990 })
  price!: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/p/SKU-001.jpg' })
  image_url?: string;
}

export class CheckoutCustomerResponse {
  @ApiPropertyOptional({ example: 'john@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  full_name?: string;

  @ApiPropertyOptional({ example: '+5511999999999' })
  phone?: string;

  @ApiPropertyOptional({ example: '123.456.789-00' })
  cpf?: string;
}

export class StartCheckoutResponse {
  @ApiProperty({ example: 'sess_abc123' })
  session_id!: string;

  @ApiProperty({ example: 'conv_xyz789' })
  conversation_id!: string;

  @ApiProperty({ example: 'user_global_123' })
  global_user_id!: string;

  @ApiProperty({ example: true })
  agent_enabled!: boolean;

  @ApiProperty({ example: 'agentic', enum: ['agentic', 'non_agentic'] })
  initial_mode!: string;

  @ApiProperty({ example: 'track_token_123' })
  tracking_token!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  experience?: Record<string, any>;

  @ApiPropertyOptional({ type: [Object] })
  turns?: any[];
}

export class CheckoutSessionResponse {
  @ApiProperty({ example: 'sess_abc123' })
  session_id!: string;

  @ApiProperty({ example: 'merchant_xyz' })
  merchant_id!: string;

  @ApiProperty({ example: 'conv_xyz789' })
  conversation_id!: string;

  @ApiProperty({ example: 'user_global_123' })
  global_user_id!: string;

  @ApiProperty({ type: [CheckoutCartItemResponse] })
  cart!: CheckoutCartItemResponse[];

  @ApiPropertyOptional({ type: CheckoutCustomerResponse })
  customer?: CheckoutCustomerResponse;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  shipping?: Record<string, any>;

  @ApiProperty({ example: 0.5 })
  abandonment_score!: number;

  @ApiProperty({ example: true })
  agent_enabled!: boolean;

  @ApiProperty({ example: '2026-08-18T12:00:00.000Z' })
  created_at!: string;
}

export class TrackEventResponse {
  @ApiProperty({ example: true })
  received!: boolean;

  @ApiProperty({ example: 0.6 })
  abandonment_score!: number;

  @ApiProperty({ example: false })
  trigger_agent!: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  progressive_offer?: Record<string, any>;
}

export class ChatMessageResponse {
  @ApiProperty({ example: 'assistant', enum: ['user', 'assistant'] })
  role!: string;

  @ApiProperty({ example: 'I can help you with a discount!' })
  content!: string;

  @ApiProperty({ example: 'conv_xyz789' })
  conversation_id!: string;

  @ApiProperty({ example: 'sess_abc123' })
  session_id!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  experience?: Record<string, any>;

  @ApiPropertyOptional({ type: [Object] })
  offers?: any[];

  @ApiPropertyOptional({ type: [Object] })
  turns?: any[];
}

export class ShippingEvaluateResponse {
  @ApiProperty({ example: true })
  approved!: boolean;

  @ApiProperty({ example: 'approve', enum: ['approve', 'deny', 'offer_subsidy'] })
  action!: string;

  @ApiProperty({ example: 'Low margin' })
  reason!: string;

  @ApiProperty({ example: 500 })
  shipping_subsidy!: number;

  @ApiProperty({ example: 0.18 })
  margin_after_offer!: number;

  @ApiProperty({ example: 'We can offer free shipping!' })
  message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  offer?: Record<string, any>;
}

export class ApplyOfferResponse {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiPropertyOptional({ example: 'SAVE10' })
  discount_code?: string;

  @ApiPropertyOptional({ example: 'https://example.com/apply' })
  apply_url?: string;

  @ApiPropertyOptional({ example: 14490 })
  new_total?: number;

  @ApiPropertyOptional({ example: '2026-08-20T23:59:59.000Z' })
  expires_at?: string;

  @ApiPropertyOptional({ example: 'Offer applied successfully' })
  reason?: string;
}

export class CompleteOrderResponse {
  @ApiProperty({ example: true })
  recorded!: boolean;

  @ApiProperty({ example: false })
  idempotent!: boolean;

  @ApiProperty({ example: 'order_completed' })
  event_type!: string;
}

export class UpdateCartResponse {
  @ApiProperty({ example: 'sess_abc123' })
  session_id!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  experience?: Record<string, any>;
}
