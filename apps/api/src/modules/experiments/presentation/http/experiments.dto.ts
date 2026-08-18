import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class VariantDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  system_prompt!: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  @Max(99)
  weight!: number;

  @ApiProperty()
  @IsBoolean()
  is_control!: boolean;
}

export class CreateExperimentRequestDto {
  @ApiProperty({ description: "Experiment name", example: "Prompt A vs B" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: "Experiment description" })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: "At least 2 variants with exactly 1 control", type: [VariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants!: VariantDto[];
}

export class UpdateExperimentRequestDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({ type: [VariantDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}

export class VariantResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() system_prompt!: string;
  @ApiProperty() weight!: number;
  @ApiProperty() is_control!: boolean;
}

export class ExperimentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() merchant_id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description!: string | null;
  @ApiProperty({ enum: ["draft", "running", "completed", "archived"] })
  status!: "draft" | "running" | "completed" | "archived";
  @ApiProperty({ type: [VariantResponseDto] }) variants!: VariantResponseDto[];
  @ApiPropertyOptional() started_at!: string | null;
  @ApiPropertyOptional() completed_at!: string | null;
  @ApiPropertyOptional() winner_variant_id!: string | null;
  @ApiProperty() created_at!: string;
  @ApiProperty() updated_at!: string;
}

export class ExperimentListResponseDto {
  @ApiProperty({ type: [ExperimentResponseDto] }) data!: ExperimentResponseDto[];
  @ApiProperty() total!: number;
}

export class VariantResultDto {
  @ApiProperty() variant_id!: string;
  @ApiProperty() variant_name!: string;
  @ApiProperty() is_control!: boolean;
  @ApiProperty() sessions!: number;
  @ApiProperty() conversions!: number;
  @ApiProperty() conversion_rate!: number;
  @ApiProperty() revenue!: number;
  @ApiProperty() avg_order_value!: number;
  @ApiProperty() offers_shown!: number;
  @ApiProperty() offers_accepted!: number;
  @ApiProperty() offer_acceptance_rate!: number;
}

export class SignificanceDto {
  @ApiProperty() winner_id!: string;
  @ApiProperty() winner_name!: string;
  @ApiProperty() confidence!: number;
  @ApiProperty() is_significant!: boolean;
  @ApiProperty() needs_more!: boolean;
}

export class ExperimentResultsResponseDto {
  @ApiProperty() experiment_id!: string;
  @ApiProperty() experiment_name!: string;
  @ApiProperty({ enum: ["draft", "running", "completed", "archived"] })
  status!: "draft" | "running" | "completed" | "archived";
  @ApiProperty({ type: [VariantResultDto] }) variant_results!: VariantResultDto[];
  @ApiPropertyOptional() significance!: SignificanceDto | null;
  @ApiProperty() total_sessions!: number;
  @ApiProperty() total_conversions!: number;
  @ApiProperty() total_revenue!: number;
  @ApiPropertyOptional() started_at!: string | null;
  @ApiPropertyOptional() completed_at!: string | null;
}
