import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ExperimentVariantInputDto {
  @ApiPropertyOptional({ example: 'var_abc123', description: 'Variant ID (for updates)' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Friendly Tone' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'You are a friendly sales assistant...' })
  @IsString()
  @IsNotEmpty()
  system_prompt!: string;

  @ApiProperty({ example: 50, description: 'Traffic weight (0-100). All variants must sum to 100.' })
  @IsNumber()
  @Min(0)
  @Max(100)
  weight!: number;

  @ApiProperty({ example: false, description: 'Whether this is the control variant' })
  @IsBoolean()
  is_control!: boolean;
}

export class CreateExperimentDto {
  @ApiProperty({ example: 'Tone of Voice Test' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Testing friendly vs formal tone' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [ExperimentVariantInputDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ExperimentVariantInputDto)
  variants!: ExperimentVariantInputDto[];
}

export class UpdateExperimentDto {
  @ApiPropertyOptional({ example: 'Updated Experiment Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [ExperimentVariantInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => ExperimentVariantInputDto)
  variants?: ExperimentVariantInputDto[];
}

export class PromoteWinnerDto {
  @ApiProperty({ example: 'var_abc123', description: 'ID of the winning variant' })
  @IsString()
  @IsNotEmpty()
  variant_id!: string;
}
