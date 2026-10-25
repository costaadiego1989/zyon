import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class OrderItemDto {
  @ApiProperty({ example: "Camiseta Básica" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 2 })
  @IsNotEmpty()
  quantity!: number;

  @ApiProperty({ example: "49.90" })
  @IsString()
  @IsNotEmpty()
  price!: string;
}

export class SendOrderConfirmationDto {
  @ApiProperty({ example: "ord_abc123" })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiProperty({ example: "buyer@example.com" })
  @IsEmail()
  recipient_email!: string;

  @ApiPropertyOptional({ example: "João Silva" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipient_name?: string;

  @ApiPropertyOptional({ example: "+5511999998888" })
  @IsOptional()
  @IsString()
  recipient_phone?: string;

  @ApiProperty({ example: "12345" })
  @IsString()
  @IsNotEmpty()
  order_number!: string;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ApiProperty({ example: "199.80" })
  @IsString()
  @IsNotEmpty()
  total!: string;

  @ApiPropertyOptional({ example: "BRL" })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class SendOrderShippedDto {
  @ApiProperty({ example: "ord_abc123" })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiProperty({ example: "buyer@example.com" })
  @IsEmail()
  recipient_email!: string;

  @ApiPropertyOptional({ example: "João Silva" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipient_name?: string;

  @ApiPropertyOptional({ example: "+5511999998888" })
  @IsOptional()
  @IsString()
  recipient_phone?: string;

  @ApiPropertyOptional({ example: "BR123456789" })
  @IsOptional()
  @IsString()
  tracking_code?: string;

  @ApiPropertyOptional({ example: "Correios" })
  @IsOptional()
  @IsString()
  carrier?: string;

  @ApiPropertyOptional({ example: "2026-08-25" })
  @IsOptional()
  @IsString()
  estimated_delivery?: string;
}

export class SendOrderDeliveredDto {
  @ApiProperty({ example: "ord_abc123" })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiProperty({ example: "buyer@example.com" })
  @IsEmail()
  recipient_email!: string;

  @ApiPropertyOptional({ example: "João Silva" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipient_name?: string;

  @ApiPropertyOptional({ example: "+5511999998888" })
  @IsOptional()
  @IsString()
  recipient_phone?: string;
}

export class SendReturnApprovedDto {
  @ApiProperty({ example: "ret_xyz789" })
  @IsString()
  @IsNotEmpty()
  return_id!: string;

  @ApiProperty({ example: "ord_abc123" })
  @IsString()
  @IsNotEmpty()
  order_id!: string;

  @ApiProperty({ example: "buyer@example.com" })
  @IsEmail()
  recipient_email!: string;

  @ApiPropertyOptional({ example: "João Silva" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recipient_name?: string;

  @ApiPropertyOptional({ example: "199.80" })
  @IsOptional()
  @IsString()
  refund_amount?: string;

  @ApiPropertyOptional({ example: "BRL" })
  @IsOptional()
  @IsString()
  currency?: string;
}

export class NotificationSentResponse {
  @ApiProperty({ example: 'sent', enum: ['sent', 'queued'] })
  status!: 'sent' | 'queued';

  @ApiProperty({ example: 'order_confirmation' })
  notification_type!: string;

  @ApiProperty({ example: 'ord_abc123' })
  order_id!: string;
}
