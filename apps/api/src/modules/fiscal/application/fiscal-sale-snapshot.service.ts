import { createHash } from "node:crypto";
import { apportionFiscalCents } from "../domain/fiscal-allocation.js";
import { validateFiscalRecipient } from "../domain/fiscal-recipient.js";
import type { FiscalSnapshotCapture, FiscalSnapshotContext, FiscalSnapshotCreate, FiscalSnapshotLine,
  FiscalSnapshotEnvelope, FiscalSnapshotStore } from "../domain/fiscal-sale-snapshot.port.js";
import type { FiscalProfileService } from "./fiscal-profile.service.js";
import { readFiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";
import { isFiscalOrderScope } from "../domain/fiscal-order-scope.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function totals(lines: readonly FiscalSnapshotLine[]) {
  return lines.reduce((sum, line) => ({ subtotalCents: sum.subtotalCents + line.grossCents, discountCents: sum.discountCents + line.discountCents,
    shippingCents: sum.shippingCents + line.shippingCents, totalCents: sum.totalCents + line.totalCents }), { subtotalCents: 0, discountCents: 0, shippingCents: 0, totalCents: 0 });
}
export class FiscalSaleSnapshotService {
  constructor(private readonly store: FiscalSnapshotStore, private readonly profiles: FiscalProfileService) {}
  async capture(input: FiscalSnapshotCapture, contexts: readonly FiscalSnapshotContext[]) {
    if (contexts.length > 1 || !isFiscalOrderScope(input.orderMerchantId, [
      ...contexts.flatMap(context => [context.merchantId, context.connection.merchantId]),
      ...input.lines.map(line => line.sellerMerchantId),
    ])) return [];
    const existing = await Promise.all(contexts.map(context => this.store.find(context, input.orderId)));
    if (existing.some(snapshot => snapshot && (!isFiscalOrderScope(input.orderMerchantId, [snapshot.merchantId, snapshot.orderMerchantId])
      || !isFiscalOrderScope(input.orderMerchantId, readFiscalSnapshotEnvelope(snapshot.items).commercialLines.map(line => line.sellerMerchantId))))) return [];
    if (existing.every(Boolean)) return existing as NonNullable<typeof existing[number]>[];
    const ids = new Set<string>();
    const raw = input.lines.map(line => {
      if (!line.lineId || ids.has(line.lineId) || !line.sku || !line.sellerMerchantId || !Number.isSafeInteger(line.quantity) || line.quantity < 1
        || !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents < 0) throw new Error("fiscal_commercial_snapshot_invalid");
      ids.add(line.lineId); return { ...line, grossCents: line.quantity * line.unitPriceCents };
    }).sort((a, b) => a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0);
    const subtotal = raw.reduce((sum, line) => sum + line.grossCents, 0);
    if (![subtotal, input.discountCents, input.shippingCents, input.totalCents].every(value => Number.isSafeInteger(value) && value >= 0)
      || input.discountCents > subtotal || subtotal - input.discountCents + input.shippingCents !== input.totalCents) throw new Error("fiscal_commercial_snapshot_invalid");
    const discounts = apportionFiscalCents(input.discountCents, raw);
    // Commercial freight ownership is independent from readiness to issue a tax document.
    const shipping = apportionFiscalCents(input.shippingCents, raw.filter(line => !["digital", "service"].includes(line.productType)));
    const allocated = raw.map(line => ({ ...line, discountCents: discounts.get(line.lineId) ?? 0, shippingCents: shipping.get(line.lineId) ?? 0,
      totalCents: line.grossCents - (discounts.get(line.lineId) ?? 0) + (shipping.get(line.lineId) ?? 0) }));
    const snapshots: FiscalSnapshotCreate[] = contexts.map(context => {
      if (context.connection.merchantId !== context.merchantId || context.connection.environment !== context.environment) throw new Error("fiscal_snapshot_scope_invalid");
      const commercialLines = allocated.filter(line => line.sellerMerchantId === context.merchantId);
      const readiness = this.profiles.readiness(context.profile);
      let readinessCode: string | null = readiness.ready ? null : readiness.code;
      const lines: FiscalSnapshotLine[] = [], pendingLines: FiscalSnapshotLine[] = [], excludedLines: FiscalSnapshotLine[] = [];
      for (const line of commercialLines) {
        if (["digital", "service"].includes(line.productType)) { excludedLines.push(line); continue; }
        const rule = readiness.ready ? readiness.configuration.items[line.sku] : undefined;
        if (readiness.ready && input.currency === readiness.configuration.currency && rule?.productType === line.productType) lines.push(line);
        else { pendingLines.push(line); readinessCode ??= "fiscal_operation_unsupported"; }
      }
      if (readiness.ready && !validateFiscalRecipient(input.recipient, readiness.requirements).valid) readinessCode = "fiscal_customer_data_required";
      const items: FiscalSnapshotEnvelope = { version: 1, sessionId: input.sessionId, connectionId: context.connection.id,
        ...(context.connection.erpConnectionId ? { erpConnectionId: context.connection.erpConnectionId } : {}),
        buyerContacts: structuredClone(input.buyerContacts ?? {}),
        profileVersionId: context.profile?.id ?? null, commercialLines, lines, pendingLines, excludedLines, readinessCode,
        policy: { stockOwner: context.connection.stockOwner, emailOwner: context.connection.emailOwner, whatsappOwner: context.connection.whatsappOwner }, fiscalTotals: totals(lines) };
      const payload = { merchantId: context.merchantId, environment: context.environment, orderMerchantId: input.orderMerchantId,
        completedOrderId: input.completedOrderId, orderId: input.orderId, completedAt: input.completedAt.toISOString(),
        buyerGlobalUserId: input.buyerGlobalUserId ?? null, currency: input.currency, recipient: input.recipient, items, ...totals(commercialLines) };
      return { ...payload, buyerGlobalUserId: input.buyerGlobalUserId, completedAt: input.completedAt,
        paymentProofRef: input.paymentProofRef, contentHash: createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex") };
    });
    return this.store.persist(snapshots);
  }
}
