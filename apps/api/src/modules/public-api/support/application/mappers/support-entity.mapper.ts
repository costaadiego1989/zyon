import type { SupportSettings, SupportTicket } from '@zyon/shared-types';
import type { ListSupportTicketsResult } from '../../../../support/application/list-support-tickets.use-case.js';
import type {
  SupportSettingsResponseDto,
  SupportTicketResponseDto,
  ListSupportTicketsResponseDto,
} from '../../presentation/http/dtos/support.dtos.js';

export class SupportEntityMapper {
  static toSettingsResponse(settings: SupportSettings): SupportSettingsResponseDto {
    return {
      merchant_id: settings.merchantId,
      faq_items: settings.faqItems.map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
      })),
      updated_at: settings.updatedAt,
    };
  }

  static toTicketResponse(ticket: SupportTicket): SupportTicketResponseDto {
    return {
      id: ticket.id,
      merchant_id: ticket.merchantId,
      session_id: ticket.sessionId,
      buyer_message: ticket.buyerMessage,
      status: ticket.status,
      source: ticket.source,
      created_at: ticket.createdAt,
      updated_at: ticket.updatedAt,
      resolved_at: ticket.resolvedAt,
    };
  }

  static toListTicketsResponse(result: ListSupportTicketsResult): ListSupportTicketsResponseDto {
    return {
      data: result.data.map((ticket) => SupportEntityMapper.toTicketResponse(ticket)),
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  }
}
