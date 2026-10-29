/** One routing authority selects a single channel for each recovery step. */
export interface CartRecoveryMessageSender {
  execute(input: {
    merchantId: string;
    type: "cart_recovery";
    toPhone?: string;
    variables?: Record<string, string | number | undefined>;
    freeformText?: string;
    fallbackEmail?: string;
    emailSubject?: string;
  }): Promise<{
    channel: "whatsapp_template" | "email" | "bubblewhats" | "none";
    status: "sent" | "skipped" | "failed" | "uncertain";
    reason?: string;
    messageId?: string;
  }>;
}
