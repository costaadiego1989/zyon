import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListAuditEventsQueryDto {
  @ApiPropertyOptional({ example: 'checkout_created', description: 'Filter by action' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ example: 'checkout', description: 'Filter by resource type' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resource_type?: string;

  @ApiPropertyOptional({ example: 'usr_abc123', description: 'Filter by actor ID' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  actor_id?: string;

  @ApiPropertyOptional({ example: '2024-08-01', description: 'Start date (ISO 8601)' })
  @IsOptional()
  @IsString()
  date_from?: string;

  @ApiPropertyOptional({ example: '2024-08-31', description: 'End date (ISO 8601)' })
  @IsOptional()
  @IsString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Pagination cursor' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cursor?: string;

  @ApiPropertyOptional({ example: 50, description: 'Items per page (1-100, default 50)' })
  @IsOptional()
  limit?: number;
}

export class AuditEventResponse {
  @ApiProperty({ example: 'evt_abc123' })
  id!: string;

  @ApiProperty({ example: 'checkout_created' })
  action!: string;

  @ApiProperty({ example: 'system', enum: ['user', 'system', 'api'] })
  actor_type!: string;

  @ApiProperty({ example: 'usr_abc123' })
  actor_id!: string;

  @ApiProperty({ example: 'checkout' })
  resource_type!: string;

  @ApiPropertyOptional({ example: 'chk_xyz789' })
  resource_id?: string;

  @ApiProperty({ example: 'success', enum: ['success', 'failed'] })
  outcome!: 'success' | 'failed';

  @ApiProperty({ example: { reason: 'user_request', details: {} } })
  metadata!: Record<string, unknown>;

  @ApiProperty({ example: '2024-08-15T10:30:00Z' })
  created_at!: string;
}

export class ListAuditEventsResponse {
  @ApiProperty({ type: [AuditEventResponse] })
  data!: AuditEventResponse[];

  @ApiPropertyOptional({ example: 'cursor_xyz' })
  next_cursor!: string | null;
}
