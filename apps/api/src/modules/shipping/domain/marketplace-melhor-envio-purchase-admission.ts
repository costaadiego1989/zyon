/** A pending cart may be debited only before any observed shipment or financial
 * history. The documented cart GET contains paid_at/generated_at; optional
 * history fields may be omitted, but a non-null value is never an empty proof.
 * This check does not prove a cancellation credit or recover a lost receipt. */
export function marketplaceMelhorEnvioCartAdmitsPurchase(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (row.status !== "pending" || row.paid_at !== null || row.generated_at !== null) return false;
  // Cart responses do not document a purchase/transaction receipt. If such
  // metadata is present, neither its shape nor an empty-looking value certifies
  // that an original wallet debit never happened.
  return ["posted_at", "delivered_at", "conciliation", "purchase", "transactions"]
    .every(field => row[field] === undefined || row[field] === null);
}
