import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TenantWebhookEventType } from '../../../../../integrations/domain/integrations.types.js';

export class ExperimentVariantResponse {
  @ApiProperty({ example: 'var_abc123', description: 'Variant ID' })
  id!: string;

  @ApiProperty({ example: 'Control Group' })
  name!: string;

  @ApiProperty({ example: 'You have items in your cart...' })
  system_prompt!: string;

  @ApiProperty({ example: 0.5, description: 'Traffic weight (0-1)' })
  weight!: number;

  @ApiProperty({ example: true, description: 'Whether this is the control variant' })
  is_control!: boolean;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;
}

export class ExperimentSummaryResponse {
  @ApiProperty({ example: 'exp_abc123', description: 'Experiment ID' })
  id!: string;

  @ApiProperty({ example: 'mch_xyz789', description: 'Merchant ID' })
  merchant_id!: string;

  @ApiProperty({ example: 'Cart Copy A/B Test' })
  name!: string;

  @ApiPropertyOptional({ example: 'Testing two variations of the cart message' })
  description!: string;

  @ApiProperty({ enum: ['draft', 'running', 'completed', 'archived'], example: 'running' })
  status!: string;

  @ApiProperty({ example: 2, description: 'Number of variants' })
  variants_count!: number;

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00Z' })
  started_at!: string;

  @ApiPropertyOptional({ example: '2024-02-20T14:45:30Z' })
  completed_at!: string;

  @ApiPropertyOptional({ example: 'var_winner_xyz', description: 'ID of winning variant if completed' })
  winner_variant_id!: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;
}

export class ExperimentDetailResponse {
  @ApiProperty({ example: 'exp_abc123', description: 'Experiment ID' })
  id!: string;

  @ApiProperty({ example: 'mch_xyz789', description: 'Merchant ID' })
  merchant_id!: string;

  @ApiProperty({ example: 'Cart Copy A/B Test' })
  name!: string;

  @ApiPropertyOptional({ example: 'Testing two variations of the cart message' })
  description!: string;

  @ApiProperty({ enum: ['draft', 'running', 'completed', 'archived'], example: 'running' })
  status!: string;

  @ApiProperty({ type: [ExperimentVariantResponse], description: 'All experiment variants' })
  variants!: ExperimentVariantResponse[];

  @ApiPropertyOptional({ example: '2024-01-15T10:30:00Z' })
  started_at!: string;

  @ApiPropertyOptional({ example: '2024-02-20T14:45:30Z' })
  completed_at!: string;

  @ApiPropertyOptional({ example: 'var_winner_xyz', description: 'ID of winning variant if completed' })
  winner_variant_id!: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  created_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  updated_at!: string;
}

export class VariantResultsMetrics {
  @ApiProperty({ example: 'var_abc123' })
  variant_id!: string;

  @ApiProperty({ example: 'Control Group' })
  variant_name!: string;

  @ApiProperty({ example: true })
  is_control!: boolean;

  @ApiProperty({ example: 1000, description: 'Sample size (unique visitors)' })
  sample_size!: number;

  @ApiProperty({ example: 150, description: 'Number of conversions' })
  conversions!: number;

  @ApiProperty({ example: 0.15, description: 'Conversion rate (0-1)' })
  conversion_rate!: number;

  @ApiProperty({ example: 2500.5, description: 'Average revenue per visitor' })
  avg_revenue!: number;

  @ApiProperty({ example: 2500500, description: 'Total revenue in cents' })
  total_revenue!: number;

  @ApiPropertyOptional({
    description: 'Funnel metrics if applicable',
    example: { view: 1000, add_to_cart: 300, checkout: 150 },
  })
  funnel?: Record<string, number> | null;
}

export class ExperimentResultsResponse {
  @ApiProperty({ example: 'exp_abc123' })
  experiment_id!: string;

  @ApiProperty({ enum: ['draft', 'running', 'completed', 'archived'], example: 'completed' })
  status!: string;

  @ApiProperty({ example: '2024-01-15T10:30:00Z' })
  started_at!: string;

  @ApiProperty({ example: '2024-02-20T14:45:30Z' })
  completed_at!: string;

  @ApiPropertyOptional({ example: 'var_winner_xyz' })
  winner_variant_id!: string;

  @ApiProperty({ type: [VariantResultsMetrics], description: 'Results per variant' })
  variants!: VariantResultsMetrics[];
}
