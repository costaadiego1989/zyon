import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class AgentCapabilityDto {
  @ApiProperty({ example: 'checkout' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'Complete checkout with items, shipping, payment',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({
    type: [String],
    example: ['checkout:start', 'checkout:track', 'checkout:complete'],
  })
  @IsArray()
  @IsString({ each: true })
  scopes!: string[];
}

export class AgentIdentityDto {
  @ApiProperty({ example: 'aacp-merchant-agent-merchant_xyz' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 'AACP Checkout Agent' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'Negotiates discounts, shipping, and completes checkouts',
  })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatars/merchant_xyz.png',
  })
  @IsOptional()
  @IsString()
  avatar_url?: string;
}

export class AgentCardEndpointsDto {
  @ApiProperty({ example: '/v1/acp/checkout_sessions' })
  @IsString()
  @IsNotEmpty()
  checkout_sessions!: string;

  @ApiProperty({ example: '/v1/acp/products/feed' })
  @IsString()
  @IsNotEmpty()
  products_feed!: string;

  @ApiProperty({ example: '/v1/acp/webhooks' })
  @IsString()
  @IsNotEmpty()
  webhooks!: string;
}

export class AgentCardDto {
  @ApiProperty({ example: '1.0' })
  @IsString()
  @IsNotEmpty()
  version!: string;

  @ApiProperty({ type: AgentIdentityDto })
  @ValidateNested()
  @Type(() => AgentIdentityDto)
  agent!: AgentIdentityDto;

  @ApiProperty({ type: [AgentCapabilityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentCapabilityDto)
  capabilities!: AgentCapabilityDto[];

  @ApiProperty({ type: AgentCardEndpointsDto })
  @ValidateNested()
  @Type(() => AgentCardEndpointsDto)
  endpoints!: AgentCardEndpointsDto;

  @ApiProperty({ example: '2026-09-03T00:00:00.000Z' })
  @IsString()
  @IsNotEmpty()
  created_at!: string;
}

export class CreateCheckoutSessionItemDto {
  @ApiProperty({ example: 'sku_123' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateCheckoutSessionBuyerDto {
  @ApiPropertyOptional({ example: 'buyer@email.com' })
  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateCheckoutSessionFulfillmentAddressDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Av. Paulista 1000' })
  @IsOptional()
  @IsString()
  line_one?: string;

  @ApiPropertyOptional({ example: 'Apto 12' })
  @IsOptional()
  @IsString()
  line_two?: string;

  @ApiPropertyOptional({ example: 'Sao Paulo' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'BR' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '01310-100' })
  @IsOptional()
  @IsString()
  postal_code?: string;
}

export class CreateCheckoutSessionDto {
  @ApiProperty({ example: 'mrc_123' })
  @IsString()
  @IsNotEmpty()
  merchant_id!: string;

  @ApiProperty({ type: [CreateCheckoutSessionItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateCheckoutSessionItemDto)
  items!: CreateCheckoutSessionItemDto[];

  @ApiPropertyOptional({ type: CreateCheckoutSessionBuyerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCheckoutSessionBuyerDto)
  buyer?: CreateCheckoutSessionBuyerDto;

  @ApiPropertyOptional({ type: CreateCheckoutSessionFulfillmentAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCheckoutSessionFulfillmentAddressDto)
  fulfillment_address?: CreateCheckoutSessionFulfillmentAddressDto;
}

export class UpdateCheckoutSessionItemDto {
  @ApiProperty({ example: 'sku_123' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  quantity!: number;
}

export class UpdateCheckoutSessionBuyerDto {
  @ApiPropertyOptional({ example: 'buyer@email.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  full_name?: string;

  @ApiPropertyOptional({ example: '+5511999998888' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @IsString()
  cpf?: string;
}

export class UpdateCheckoutSessionDto {
  @ApiProperty({ example: 'mrc_123' })
  @IsString()
  @IsNotEmpty()
  merchant_id!: string;

  @ApiPropertyOptional({ example: 'Correios-PAC-0' })
  @IsOptional()
  @IsString()
  fulfillment_option_id?: string;

  @ApiPropertyOptional({ type: [UpdateCheckoutSessionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCheckoutSessionItemDto)
  line_items?: UpdateCheckoutSessionItemDto[];

  @ApiPropertyOptional({ example: 'PROMO10' })
  @IsOptional()
  @IsString()
  coupon_code?: string;

  @ApiPropertyOptional({ type: UpdateCheckoutSessionBuyerDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCheckoutSessionBuyerDto)
  buyer?: UpdateCheckoutSessionBuyerDto;

  @ApiPropertyOptional({ type: CreateCheckoutSessionFulfillmentAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateCheckoutSessionFulfillmentAddressDto)
  fulfillment_address?: CreateCheckoutSessionFulfillmentAddressDto;
}

export class CompleteCheckoutSessionDto {
  @ApiProperty({ example: 'mrc_123' })
  @IsString()
  @IsNotEmpty()
  merchant_id!: string;

  @ApiProperty({
    example: 'aacp_embed_v1.eyJ0eXAiOiJhYWNwX2VtYmVkX3YxIn0.abc',
    description:
      'AACP embed token (aacp_embed_v1.<claims>.<sig>) — verified against the configured scope `payment:intents:confirm`.',
  })
  @IsString()
  @IsNotEmpty()
  payment_token!: string;

  @ApiPropertyOptional({ example: 'pix', enum: ['pix', 'credit_card', 'boleto', 'crypto'] })
  @IsOptional()
  @IsString()
  payment_method?: 'pix' | 'credit_card' | 'boleto' | 'crypto';

  @ApiPropertyOptional({
    example: 'order_ref_42',
    description: 'Optional idempotency key for the payment intent.',
  })
  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @ApiPropertyOptional({ example: 'buyer@email.com' })
  @IsOptional()
  @IsString()
  buyer_email?: string;

  @ApiPropertyOptional({
    example: 'shipping-discount-offer-id',
    description: 'Authorized offer id applied during this session (if any).',
  })
  @IsOptional()
  @IsString()
  accepted_offer_id?: string;
}

export class CompleteCheckoutSessionResponseDto {
  @ApiProperty({ example: 'order_ref_42' })
  order_id!: string;

  @ApiProperty({ example: 'completed', enum: ['completed'] })
  status!: 'completed';

  @ApiProperty({ example: 'https://merchant-slug.aacp.dev/orders/order_ref_42' })
  confirmation_url!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Final ACP canonical session shape.',
  })
  session!: unknown;
}
