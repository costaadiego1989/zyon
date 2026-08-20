import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ===== Approval DTOs =====

export class ApproveHypothesisDto {
  @ApiProperty({ description: "ID of the user approving the hypothesis" })
  approved_by!: string;

  @ApiPropertyOptional({ description: "Reason for approval" })
  approval_reason?: string;
}

export class RejectHypothesisDto {
  @ApiProperty({ description: "Reason for rejecting the hypothesis" })
  reason!: string;
}

// ===== Response DTOs =====

export class ObservationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() merchant_id!: string;
  @ApiProperty() observation_window_start!: string;
  @ApiProperty() observation_window_end!: string;
  @ApiProperty() funnel!: object;
  @ApiProperty() abandonment!: object;
  @ApiProperty() objections!: object;
  @ApiProperty() cross_sell!: object;
  @ApiPropertyOptional() current_experiment?: object;
  @ApiProperty() cohorts!: object;
  @ApiProperty() revenue!: object;
  @ApiProperty() ai_costs_cents!: number;
  @ApiProperty() created_at!: string;
}

export class HypothesisResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() merchant_id!: string;
  @ApiProperty() observation_id!: string;
  @ApiProperty() hypothesis_text!: string;
  @ApiProperty() reasoning!: string;
  @ApiProperty() expected_lift_percent!: number;
  @ApiProperty() risk_level!: string;
  @ApiProperty() template!: object;
  @ApiProperty() status!: string;
  @ApiProperty() approval_strategy!: string;
  @ApiPropertyOptional() merchant_approved_at?: string;
  @ApiPropertyOptional() merchant_approved_by?: string;
  @ApiPropertyOptional() merchant_approval_reason?: string;
  @ApiPropertyOptional() rejection_reason?: string;
  @ApiPropertyOptional() created_experiment_id?: string;
  @ApiProperty() created_at!: string;
  @ApiProperty() updated_at!: string;
}

export class StrategyLessonResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() merchant_id!: string;
  @ApiProperty() experiment_id!: string;
  @ApiProperty() hypothesis_id!: string;
  @ApiProperty() hypothesis_text!: string;
  @ApiProperty() actual_winner!: string;
  @ApiProperty() hypothesis_was_correct!: boolean;
  @ApiProperty() control_conversion_rate!: number;
  @ApiProperty() challenger_conversion_rate!: number;
  @ApiProperty() conversion_lift_percent!: number;
  @ApiProperty() sessions_per_variant!: number;
  @ApiProperty() statistical_confidence!: number;
  @ApiProperty() insights!: object;
  @ApiProperty() generator_feedback!: string;
  @ApiProperty() recorded_at!: string;
}

export class ApproveHypothesisResponseDto {
  @ApiProperty() hypothesis_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() approved_at!: string;
}

export class RejectHypothesisResponseDto {
  @ApiProperty() hypothesis_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() rejection_reason!: string;
}
