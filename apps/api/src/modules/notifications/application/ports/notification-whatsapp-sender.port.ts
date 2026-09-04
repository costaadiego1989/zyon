/**
 * Optional port for the safe WhatsApp template send path, provided by the
 * whatsapp-templates module. Declared here so notification use-cases stay
 * decoupled from that module's concrete class (avoids an import cycle; the
 * provider is bound via useExisting in the module wiring).
 */
export const NOTIFICATION_WHATSAPP_SENDER = Symbol("NOTIFICATION_WHATSAPP_SENDER");

export interface NotificationWhatsAppSender {
  execute(input: {
    merchantId: string;
    type: "order_confirmation" | "order_shipped" | "order_delivered";
    toPhone?: string;
    variables?: Record<string, string | number | undefined>;
    freeformText?: string;
    fallbackEmail?: string;
    emailSubject?: string;
  }): Promise<unknown>;
}
