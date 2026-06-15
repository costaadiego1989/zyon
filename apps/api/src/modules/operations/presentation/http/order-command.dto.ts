import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CancelOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  notify_customer?: boolean;

  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}

export class CreateOrderDto {
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  payment_id!: string;
}
