/** Persist only stable diagnostic codes, never provider payloads or buyer data. */
export function whatsappProcessingErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^P\d{4}$/.test(code)) return `whatsapp_database_${code}`;
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && /^whatsapp_[a-z0-9_]{1,96}$/.test(message)) return message;
  }
  return "whatsapp_inbox_processing_failed";
}
