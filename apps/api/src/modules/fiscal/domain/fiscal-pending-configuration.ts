import type {
  FiscalSnapshotRecord,
  FiscalSnapshotEnvelope,
} from "./fiscal-sale-snapshot.port.js";
import { readFiscalSnapshotEnvelope } from "./fiscal-sale-snapshot.port.js";
import type {
  FiscalProfileRecord,
  FiscalProfileReadiness,
} from "./fiscal-profile.port.js";
import { validateFiscalRecipient } from "./fiscal-recipient.js";
/** Rebuilds an execution view only. Original commercial snapshot/recipient/hash are never mutated. */
export function configuredFiscalEnvelope(
  snapshot: FiscalSnapshotRecord,
  profile: FiscalProfileRecord,
  readiness: FiscalProfileReadiness
): FiscalSnapshotEnvelope {
  if (!readiness.ready) throw new Error(readiness.code);
  if (snapshot.currency !== readiness.configuration.currency)
    throw new Error("fiscal_operation_unsupported");
  if (
    !validateFiscalRecipient(snapshot.recipient, readiness.requirements).valid
  )
    throw new Error("fiscal_customer_data_required");
  const original = readFiscalSnapshotEnvelope(snapshot.items);
  const excluded = new Set(original.excludedLines.map((l) => l.lineId));
  const lines = original.commercialLines.filter(
    (l) =>
      !excluded.has(l.lineId) && !["digital", "service"].includes(l.productType)
  );
  if (
    !lines.length ||
    lines.some(
      (l) => readiness.configuration.items[l.sku]?.productType !== l.productType
    )
  )
    throw new Error("fiscal_operation_unsupported");
  const fiscalTotals = lines.reduce(
    (t, l) => ({
      subtotalCents: t.subtotalCents + l.grossCents,
      discountCents: t.discountCents + l.discountCents,
      shippingCents: t.shippingCents + l.shippingCents,
      totalCents: t.totalCents + l.totalCents,
    }),
    { subtotalCents: 0, discountCents: 0, shippingCents: 0, totalCents: 0 }
  );
  if (
    fiscalTotals.totalCents <= 0 ||
    fiscalTotals.totalCents > snapshot.totalCents
  )
    throw new Error("fiscal_payment_allocation_invalid");
  return {
    ...original,
    profileVersionId: profile.id,
    lines,
    pendingLines: [],
    readinessCode: null,
    fiscalTotals,
  };
}
