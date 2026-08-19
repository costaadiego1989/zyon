import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateInstallationDto {
  @ApiProperty({ example: 'My Store' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: ['https://example.com', 'https://store.example.com'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { each: true })
  allowed_origins!: string[];

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version?: string;

  @ApiPropertyOptional({ example: 'production' })
  @IsOptional()
  @IsString()
  environment?: string;
}

export class UpdateInstallationDto {
  @ApiPropertyOptional({ example: 'My Store Updated' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: ['https://example.com'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true }, { each: true })
  allowed_origins?: string[];

  @ApiPropertyOptional({ example: '1.0.1' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  widget_version?: string;

  @ApiPropertyOptional({ example: 'active' })
  @IsOptional()
  @IsString()
  status?: string;
}

export class InstallationResponse {
  @ApiProperty({ example: 'inst_abc123' })
  id!: string;

  @ApiProperty({ example: 'My Store' })
  name!: string;

  @ApiProperty({ example: 'production', enum: ['test', 'live'] })
  environment!: string;

  @ApiProperty({ example: 'active', enum: ['active', 'disabled'] })
  status!: string;

  @ApiProperty({ example: '1.0.0' })
  widget_version!: string;

  @ApiProperty({ example: ['https://example.com', 'https://store.example.com'] })
  allowed_origins!: string[];

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-08-01T14:00:00Z' })
  updated_at!: string;
}

export class InstallationListResponse {
  @ApiProperty({ type: [InstallationResponse] })
  data!: InstallationResponse[];

  @ApiPropertyOptional({ example: 'cursor_xyz' })
  next_cursor!: string | null;

  @ApiProperty({ example: true })
  has_more!: boolean;
}
