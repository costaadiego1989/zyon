import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { SupportTicket, SupportTicketStatus } from "@zyon/shared-types";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import {
  SUPPORT_TICKET_REPOSITORY,
  type SupportTicketRepository,
  encodeSupportTicketCursor,
} from "../domain/ports/support-ticket-repository.port.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface ListSupportTicketsResult {
  data: SupportTicket[];
  has_more: boolean;
  next_cursor: string | null;
}

@Injectable()
export class ListSupportTicketsUseCase {
  constructor(
    @Inject(SUPPORT_TICKET_REPOSITORY)
    private readonly repository: SupportTicketRepository
  ) {}

  async execute(
    merchantId: string,
    status?: string,
    limit?: number,
    cursor?: string
  ): Promise<ListSupportTicketsResult> {
    if (status && !isSupportTicketStatus(status)) {
      throw new BadRequestException("support_ticket_invalid_status");
    }

    const pageSize = Math.min(
      typeof limit === "number" && limit > 0 ? limit : DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );

    // P2 fix: fetch pageSize+1 rows to detect has_more
    const rows = await this.repository.list(
      merchantId,
      status as SupportTicketStatus | undefined,
      pageSize,
      cursor
    );

    const has_more = rows.length > pageSize;
    const data = has_more ? rows.slice(0, pageSize) : rows;
    const last = data[data.length - 1];
    const next_cursor =
      has_more && last ? encodeSupportTicketCursor(last.createdAt, last.id) : null;

    return { data, has_more, next_cursor };
  }
}
