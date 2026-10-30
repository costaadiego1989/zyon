import { normalizeRecoveryRecipient } from "../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js";

/** Operational contacts are recipients; a connected business number is a sender. */
export function merchantOrderNotificationPhone(budgetWhatsapp: unknown, settings: unknown, sender: unknown): string | undefined {
  const company = (settings as { company?: { phone?: unknown } } | null)?.company;
  const raw = typeof budgetWhatsapp === "string" && budgetWhatsapp.trim()
    ? budgetWhatsapp.trim() : typeof company?.phone === "string" ? company.phone.trim() : "";
  if (!raw) return undefined;
  const phone = normalizeRecoveryRecipient(raw);
  const senderPhone = typeof sender === "string" ? normalizeRecoveryRecipient(sender) : null;
  return phone && senderPhone && phone !== senderPhone ? phone : undefined;
}
