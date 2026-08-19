import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListAuditEventsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  resource_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  actor_id?: string;

  @IsOptional()
  @IsString()
  date_from?: string;

  @IsOptional()
  @IsString()
  date_to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cursor?: string;

  @IsOptional()
  limit?: number;
}

export class AuditEventResponse {
  id: string;
  action: string;
  actor_type: string;
  actor_id: string;
  resource_type: string;
  resource_id?: string;
  outcome: 'success' | 'failed';
  metadata: Record<string, unknown>;
  created_at: string;
}

export class ListAuditEventsResponse {
  data: AuditEventResponse[];
  next_cursor: string | null;
}
