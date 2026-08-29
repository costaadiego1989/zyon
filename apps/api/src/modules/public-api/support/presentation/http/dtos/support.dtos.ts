import { ApiProperty } from '@nestjs/swagger';

export class SupportFaqItemDto {
  @ApiProperty({ description: 'FAQ item ID' })
  id!: string;

  @ApiProperty({ description: 'Question text' })
  question!: string;

  @ApiProperty({ description: 'Answer text' })
  answer!: string;
}

export class SupportSettingsResponseDto {
  @ApiProperty({ description: 'Merchant ID' })
  merchant_id!: string;

  @ApiProperty({ type: [SupportFaqItemDto], description: 'FAQ items' })
  faq_items!: SupportFaqItemDto[];

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updated_at!: string;
}

export class SupportTicketResponseDto {
  @ApiProperty({ description: 'Support ticket ID' })
  id!: string;

  @ApiProperty({ description: 'Merchant ID' })
  merchant_id!: string;

  @ApiProperty({ description: 'Checkout session ID (optional)', required: false })
  session_id?: string;

  @ApiProperty({ description: 'Initial buyer message' })
  buyer_message!: string;

  @ApiProperty({ description: 'Ticket status', enum: ['open', 'in_progress', 'resolved', 'closed'] })
  status!: 'open' | 'in_progress' | 'resolved' | 'closed';

  @ApiProperty({ description: 'Ticket source', enum: ['widget', 'dashboard', 'system', 'return_request'] })
  source!: 'widget' | 'dashboard' | 'system' | 'return_request';

  @ApiProperty({ description: 'Creation timestamp (ISO 8601)' })
  created_at!: string;

  @ApiProperty({ description: 'Last update timestamp (ISO 8601)' })
  updated_at!: string;

  @ApiProperty({ description: 'Resolution timestamp (ISO 8601, optional)', required: false })
  resolved_at?: string;
}

export class ListSupportTicketsResponseDto {
  @ApiProperty({ type: [SupportTicketResponseDto], description: 'Array of support tickets' })
  data!: SupportTicketResponseDto[];

  @ApiProperty({ description: 'Whether more results are available' })
  has_more!: boolean;

  @ApiProperty({
    description: 'Cursor for next page (null if no more results)',
    required: false,
    nullable: true,
  })
  next_cursor!: string | null;
}
