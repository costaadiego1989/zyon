export const EMAIL_SENDER_PORT = Symbol("EmailSenderPort");

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Resolves logo, company registration and social links for merchant-owned email. */
  merchantId?: string;
  from?: string;
  /** Require provider acceptance; never report the development logging fallback as delivery. */
  requireDelivery?: boolean;
  idempotencyKey?: string;
}

export interface SendEmailOutput {
  messageId: string;
  status: "sent" | "queued" | "skipped";
}

export interface EmailSenderPort {
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}
