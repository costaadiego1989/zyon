import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsObject,
  Min,
} from 'class-validator';

// Request DTOs

export class CreditCardDto {
  @ApiProperty({ example: '4111111111111111' })
  @IsString()
  @IsNotEmpty()
  number!: string;

  @ApiProperty({ example: 12 })
  @IsNumber()
  month!: number;

  @ApiProperty({ example: 2027 })
  @IsNumber()
  year!: number;

  @ApiProperty({ example: '123' })
  @IsString()
  @IsNotEmpty()
  cvc!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  holder_name?: string;
}

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 'sess_abc123' })
  @IsString()
  @IsNotEmpty()
  session_id!: string;

  @ApiPropertyOptional({ example: 'idempotency_key_123' })
  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @ApiProperty({
    example: 'pix',
    enum: ['pix', 'credit_card', 'crypto', 'stripe'],
  })
  @IsString()
  @IsNotEmpty()
  method!: string;

  @ApiPropertyOptional({ example: 'offer_abc123' })
  @IsOptional()
  @IsString()
  accepted_offer_id?: string;

  @ApiPropertyOptional({ type: CreditCardDto })
  @IsOptional()
  @IsObject()
  credit_card?: CreditCardDto;
}

export class ConfirmPaymentDto {
  @ApiProperty({ example: 'sess_abc123' })
  @IsString()
  @IsNotEmpty()
  session_id!: string;
}

// Response DTOs

export class PaymentIntentResponse {
  @ApiProperty({ example: 'pi_abc123' })
  intent_id!: string;

  @ApiProperty({
    example: 'pending',
    enum: ['pending', 'processing', 'approved', 'declined', 'error'],
  })
  status!: string;

  @ApiProperty({ example: 14990 })
  amount_cents!: number;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiProperty({
    example: 'pix',
    enum: ['pix', 'credit_card', 'crypto', 'stripe'],
  })
  method!: string;

  @ApiPropertyOptional({ example: 'charge_stripe_123' })
  provider_payment_id?: string;

  @ApiPropertyOptional({ example: 'pk_live_secret_123' })
  client_secret?: string;

  @ApiPropertyOptional({
    example:
      '00020126580014br.gov.bcb.pix0136550e8422-73da-4aba-96df-b13c9d7f0e9552040000353039865802BR5913Acme Corp6009Sao Paulo62410503***630459F8',
  })
  pix_qr_code?: string;

  @ApiPropertyOptional({
    example:
      '00020126580014br.gov.bcb.pix0136550e8422-73da-4aba-96df-b13c9d7f0e95',
  })
  pix_copy_paste?: string;

  @ApiPropertyOptional({
    example: '1A1z7agorar2Ld1CDekuCeeDQQyjiT7jqN',
  })
  crypto_address?: string;

  @ApiProperty({ example: '2026-08-18T12:00:00.000Z' })
  created_at!: string;
}

export class PaymentStatusResponse {
  @ApiProperty({ example: 'pi_abc123' })
  intent_id!: string;

  @ApiProperty({
    example: 'approved',
    enum: ['pending', 'processing', 'approved', 'declined', 'error'],
  })
  status!: string;

  @ApiProperty({ example: 14990 })
  amount_cents!: number;

  @ApiPropertyOptional({ example: 14990 })
  approved_amount_cents?: number;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiProperty({
    example: 'pix',
    enum: ['pix', 'credit_card', 'crypto', 'stripe'],
  })
  method!: string;

  @ApiPropertyOptional({ example: 'order_abc123' })
  order_id?: string;

  @ApiPropertyOptional({ example: 'charge_stripe_123' })
  provider_payment_id?: string;

  @ApiPropertyOptional({
    example: 'https://stripe.com/receipts/receipt_123',
  })
  receipt_url?: string;
}

export class PaymentConfirmResponse {
  @ApiProperty({ example: 'pi_abc123' })
  intent_id!: string;

  @ApiProperty({
    example: 'approved',
    enum: ['pending', 'processing', 'approved', 'declined', 'error'],
  })
  status!: string;
}
