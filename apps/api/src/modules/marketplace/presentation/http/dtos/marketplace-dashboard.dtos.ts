import { IsString, IsOptional, IsNumber, Min, Max, IsIn, IsNotEmpty, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ── Query DTOs ──────────────────────────────────────────────────────────────

export class ListSettlementsQueryDto {
  @ApiPropertyOptional({ example: "awaiting_return_window" })
  @IsOptional()
  @IsString()
  @IsIn([
    "awaiting_return_window",
    "transfer_scheduled",
    "transferred",
    "finalized",
    "return_cancelled",
    "chargeback_cancelled",
    "chargeback_debt",
  ])
  status?: string;

  @ApiPropertyOptional({ example: "2026-01-01T00:00:00Z" })
  @IsOptional()
  @IsString()
  created_after?: string;

  @ApiPropertyOptional({ example: "2026-12-31T23:59:59Z" })
  @IsOptional()
  @IsString()
  created_before?: string;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number;
}

export class ListDebtsQueryDto {
  @ApiPropertyOptional({ example: "outstanding" })
  @IsOptional()
  @IsString()
  @IsIn(["outstanding", "deducted", "resolved"])
  status?: string;
}

export class ShipMarketplaceLineItemDto {
  @ApiProperty({ example: "BR123456789" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  tracking_number!: string;
}

// ── Response DTOs ───────────────────────────────────────────────────────────

export class SettlementResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() hostMerchantId!: string;
  @ApiProperty() sellerMerchantId!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() lineItemId!: string;
  @ApiProperty() totalAmountCents!: number;
  @ApiProperty() commissionCents!: number;
  @ApiProperty() sellerNetCents!: number;
  @ApiProperty() status!: string;
  @ApiProperty() returnWindowUntil!: string;
  @ApiPropertyOptional() transferScheduledAt?: string | null;
  @ApiProperty() chargebackWindowUntil!: string;
  @ApiPropertyOptional() transferredAt?: string | null;
  @ApiPropertyOptional() finalizedAt?: string | null;
  @ApiPropertyOptional() chargebackAt?: string | null;
  @ApiPropertyOptional() returnAt?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class TimelineEntryDto {
  @ApiProperty() status!: string;
  @ApiPropertyOptional() timestamp!: string | null;
  @ApiProperty() label!: string;
}

export class DebtResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() sellerMerchantId!: string;
  @ApiProperty() settlementId!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() status!: string;
  @ApiPropertyOptional() deductedFromSettlementId?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() resolvedAt?: string | null;
}

export class SettlementDetailResponseDto {
  @ApiProperty() settlement!: SettlementResponseDto;
  @ApiProperty({ type: [TimelineEntryDto] }) timeline!: TimelineEntryDto[];
  @ApiProperty() availableTransitions!: string[];
  @ApiPropertyOptional() debt?: DebtResponseDto | null;
}

export class ListSettlementsResponseDto {
  @ApiProperty({ type: [SettlementResponseDto] }) settlements!: SettlementResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
}

export class ListDebtsResponseDto {
  @ApiProperty({ type: [DebtResponseDto] }) debts!: DebtResponseDto[];
  @ApiProperty() totalOutstandingCents!: number;
  @ApiProperty() totalDeductedCents!: number;
  @ApiProperty() totalResolvedCents!: number;
}

export class ChargebackEntryDto {
  @ApiProperty() settlement!: SettlementResponseDto;
  @ApiPropertyOptional() debt?: DebtResponseDto | null;
  @ApiProperty() type!: "chargeback_cancelled" | "chargeback_debt";
}

export class ListChargebacksResponseDto {
  @ApiProperty({ type: [ChargebackEntryDto] }) chargebacks!: ChargebackEntryDto[];
  @ApiProperty() totalDebtCents!: number;
  @ApiProperty() totalCancelled!: number;
  @ApiProperty() totalWithDebt!: number;
}

export class DebtDetailResponseDto {
  @ApiProperty() debt!: DebtResponseDto;
  @ApiPropertyOptional() originSettlement?: { id: string; orderId: string } | null;
  @ApiProperty() deductionHistory!: Array<{
    deductedFromSettlementId: string;
    deductedAt: string | null;
  }>;
}
