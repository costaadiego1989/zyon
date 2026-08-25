export const SCHEDULED_MESSAGE_REPOSITORY = Symbol("SCHEDULED_MESSAGE_REPOSITORY");

export interface ScheduledMessage {
  id: string;
  merchantId: string;
  buyerId: string;
  orderId: string;
  type: "follow_up" | "review_request" | "nps" | "cross_sell" | "win_back" | "loyalty" | "reorder";
  channel: "whatsapp" | "email";
  sendAt: Date;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentAt: Date | null;
  messageContent: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  productName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateScheduledMessageInput {
  merchantId: string;
  buyerId: string;
  orderId: string;
  type: ScheduledMessage["type"];
  channel: ScheduledMessage["channel"];
  sendAt: Date;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  productName?: string;
  metadata?: Record<string, unknown>;
}

export interface ScheduledMessageRepositoryPort {
  create(input: CreateScheduledMessageInput): Promise<ScheduledMessage>;
  findPendingDue(limit: number): Promise<ScheduledMessage[]>;
  update(
    id: string,
    data: {
      status?: ScheduledMessage["status"];
      sentAt?: Date;
      messageContent?: string;
    }
  ): Promise<ScheduledMessage>;
  findByOrderId(merchantId: string, orderId: string): Promise<ScheduledMessage[]>;
  countByStatus(merchantId: string, status: ScheduledMessage["status"]): Promise<number>;
  countAll(merchantId: string): Promise<number>;
}
