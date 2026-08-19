import {
  ApiProperty,
  ApiPropertyOptional,
} from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateInstallationDto {
  @ApiProperty({ example: "My Store" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: ["https://example.com", "https://store.example.com"] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ["https", "http"], require_protocol: true }, { each: true })
  allowed_origins!: string[];

  @ApiPropertyOptional({ example: "1.0.0" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version?: string;

  @ApiPropertyOptional({ example: "production" })
  @IsOptional()
  @IsString()
  environment?: string;
}

export class UpdateInstallationDto {
  @ApiPropertyOptional({ example: "My Store Updated" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: ["https://example.com"] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ["https", "http"], require_protocol: true }, { each: true })
  allowed_origins?: string[];

  @ApiPropertyOptional({ example: "1.0.1" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version?: string;

  @ApiPropertyOptional({ example: "active" })
  @IsOptional()
  @IsString()
  status?: string;
}

export interface InstallationResponse {
  id: string;
  name: string;
  environment: string;
  status: string;
  widget_version: string;
  allowed_origins: string[];
  created_at: string;
  updated_at: string;
}

export interface InstallationListResponse {
  data: InstallationResponse[];
  next_cursor: string | null;
  has_more: boolean;
}
