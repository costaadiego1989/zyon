export const EMAIL_SENDER_PORT = Symbol("EmailSenderPort");

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface SendEmailOutput {
  messageId: string;
  status: "sent" | "queued";
}

export interface EmailSenderPort {
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}
