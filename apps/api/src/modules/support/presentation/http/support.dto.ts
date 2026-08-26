import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

class SupportFaqItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  id!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  question!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  answer!: string;
}

export class UpdateSupportSettingsDto {
  @ApiProperty({ type: [SupportFaqItemDto] })
  @IsArray()
  @ArrayMaxSize(20) // SUPP-L3: Unified with entity MAX_FAQ_ITEMS = 20
  @ValidateNested({ each: true })
  @Type(() => SupportFaqItemDto)
  faqItems!: SupportFaqItemDto[];
}

export class CreateSupportTicketDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  session_id?: string;
}

export class UpdateSupportTicketDto {
  @ApiProperty({
    enum: ["open", "in_progress", "resolved", "closed"],
  })
  @IsIn(["open", "in_progress", "resolved", "closed"])
  status!: "open" | "in_progress" | "resolved" | "closed";
}

/**
 * P0+P1 fix: validated DTO for the widget chat endpoint.
 * `merchant_id` is intentionally absent — it is derived from the verified embed
 * token by the controller, never trusted from the request body.
 */
export class SupportChatDto {
  @ApiProperty({ description: "Buyer message to the support assistant", maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional({ description: "Checkout or browse session id", maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  session_id?: string;
}

/**
 * Public storefront chat DTO. merchantId is taken from the body (public
 * storefront pages are unauthenticated). FAQ + support chat are public
 * buyer-facing data, so no embed token is required. Rate limiting and the
 * "never invent" LLM guard keep this safe.
 */
export class PublicSupportChatDto {
  @ApiProperty({ description: "Merchant id (public storefront tenant)", maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  merchant_id!: string;

  @ApiProperty({ description: "Buyer message to the support assistant", maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @ApiPropertyOptional({ description: "Browse session id", maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  session_id?: string;
}
