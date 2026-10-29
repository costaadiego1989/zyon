import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateInstallationDto {
  @ApiProperty({ example: "Loja principal" })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: ["test", "live"], example: "test" })
  @IsIn(["test", "live"])
  environment!: "test" | "live";

  @ApiProperty({ example: "1.0.0" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version!: string;

  @ApiProperty({
    type: [String],
    example: ["https://checkout.example.com"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowed_origins!: string[];
}

export class UpdateInstallationDto {
  @ApiPropertyOptional({ example: "Loja principal" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({
    enum: ["active", "disabled", "degraded"],
  })
  @IsOptional()
  @IsIn(["active", "disabled", "degraded"])
  status?: "active" | "disabled" | "degraded";

  @ApiPropertyOptional({ example: "1.1.0" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ["https://checkout.example.com"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowed_origins?: string[];
}

export class ReportInstallationHealthDto {
  @ApiProperty({ example: "https://checkout.example.com" })
  @IsString()
  origin!: string;

  @ApiProperty({ example: "1.1.0" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  healthy!: boolean;

  @ApiPropertyOptional({ example: "widget_boot_timeout" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  error_code?: string;
}
