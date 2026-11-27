import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProfileConfiguration, FiscalProfileRecord } from "../../domain/fiscal-profile.port.js";
import { readFiscalSnapshotEnvelope, type FiscalSnapshotRecord } from "../../domain/fiscal-sale-snapshot.port.js";
import { validateFiscalRecipient } from "../../domain/fiscal-recipient.js";
import { fiscalObjectFingerprint } from "./omie-fiscal.payload.js";
export interface OlistFiscalProfileConfiguration extends FiscalProfileConfiguration {
  operation: { naturezaOperacaoId: number; ecommerceId: number; consumidorFinal: boolean; countryName: string; timeZone: string; products: Record<string, { productId: number }> };
}
export interface OlistFiscalPayload extends Readonly<Record<string, unknown>> {
  kind: "olist_order_v3"; reference: string; profileVersionId: string; configurationFingerprint: string; totalCents: number;
  issueDate: string; emailOwner: string; buyerEmail: string; contact: Record<string, unknown>; order: Record<string, unknown>;
  products: { id: number; sku: string; ncm: string; origin: string; unit: string; cfop: string; quantity: number; unitPriceCents: number }[];
}
export function buildOlistFiscalPayload(input: { identity: FiscalIdentity; snapshot: FiscalSnapshotRecord; profile: FiscalProfileRecord; issuedAt: string; fiscalPayment: { formaRecebimentoId: number; meioPagamentoId: number } }): OlistFiscalPayload {
  const { identity, snapshot, profile } = input; const e = readFiscalSnapshotEnvelope(snapshot.items); const config = profile.itemRules as OlistFiscalProfileConfiguration; const op = config?.operation;
  const positive = (id: unknown) => Number.isSafeInteger(id) && Number(id) > 0;
  if (!profile.confirmedAt || !profile.confirmedBy || profile.provider !== "tiny" || profile.id !== e.profileVersionId || profile.merchantId !== identity.merchantId || snapshot.merchantId !== identity.merchantId
    || profile.environment !== identity.environment || snapshot.environment !== identity.environment || config.currency !== "BRL" || snapshot.currency !== "BRL" || !op || !positive(op.naturezaOperacaoId) || !positive(op.ecommerceId)
    || typeof op.consumidorFinal !== "boolean" || !op.countryName?.trim() || !positive(input.fiscalPayment.formaRecebimentoId) || !positive(input.fiscalPayment.meioPagamentoId)) throw new Error("fiscal_profile_or_payment_configuration_required");
  if (!e.lines.length || e.pendingLines.length || e.readinessCode) throw new Error("fiscal_snapshot_not_ready");
  const r = validateFiscalRecipient(snapshot.recipient, ["name", "taxId", "address.street", "address.number", "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode", "address.countryCode"]);
  if (!r.valid) throw new Error("fiscal_recipient_configuration_required"); const a = r.recipient.address!;
  const date = (instant: string) => { if (!Number.isFinite(Date.parse(instant))) throw new Error("fiscal_time_invalid"); const parts = new Intl.DateTimeFormat("en-CA", { timeZone: op.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant)); const value = (key: string) => parts.find(part => part.type === key)!.value; return `${value("year")}-${value("month")}-${value("day")}`; };
  const products = e.lines.map(line => { const rule = config.items[line.sku]; const id = op.products[line.sku]?.productId;
    if (!rule || !positive(id) || !/^\d{8}$/.test(rule.ncm) || !/^\d{4}$/.test(rule.cfop) || !/^[0-8]$/.test(rule.origin) || !rule.unit || !Object.keys(rule.taxes ?? {}).length) throw new Error("fiscal_product_configuration_required");
    if (![line.unitPriceCents, line.grossCents, line.discountCents, line.shippingCents, line.totalCents].every(n => Number.isSafeInteger(n) && n >= 0) || line.quantity <= 0 || Math.round(line.quantity * line.unitPriceCents) !== line.grossCents || line.totalCents !== line.grossCents - line.discountCents + line.shippingCents) throw new Error("fiscal_amount_invalid");
    return { id: id!, sku: line.sku, ncm: rule.ncm, origin: rule.origin, unit: rule.unit, cfop: rule.cfop, quantity: line.quantity, unitPriceCents: line.unitPriceCents }; });
  const t = e.fiscalTotals;
  if (t.subtotalCents !== e.lines.reduce((s, l) => s + l.grossCents, 0) || t.discountCents !== e.lines.reduce((s, l) => s + l.discountCents, 0) || t.shippingCents !== e.lines.reduce((s, l) => s + l.shippingCents, 0) || t.totalCents !== t.subtotalCents - t.discountCents + t.shippingCents) throw new Error("fiscal_totals_mismatch");
  const buyerEmail = (e.buyerContacts.email ?? "").trim().toLowerCase(); if (buyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new Error("fiscal_email_invalid");
  return { kind: "olist_order_v3", reference: identity.reference, profileVersionId: profile.id, configurationFingerprint: fiscalObjectFingerprint(config), totalCents: t.totalCents, issueDate: date(input.issuedAt), emailOwner: e.policy.emailOwner, buyerEmail, products,
    contact: { codigo: identity.reference + ":contact", nome: r.recipient.name, tipoPessoa: r.recipient.taxId!.length === 11 ? "F" : "J", cpfCnpj: r.recipient.taxId, emailNfe: buyerEmail,
      endereco: { endereco: a.street, numero: a.number, complemento: a.complement ?? "", bairro: a.neighborhood, municipio: a.city, uf: a.state, cep: a.postalCode, pais: op.countryName } },
    order: { situacao: 0, data: date(snapshot.completedAt.toISOString()), valorDesconto: t.discountCents / 100, valorFrete: t.shippingCents / 100, valorOutrasDespesas: 0,
      naturezaOperacao: { id: op.naturezaOperacaoId }, ecommerce: { id: op.ecommerceId, numeroPedidoEcommerce: identity.reference }, consumidorFinal: { clienteConsumidorFinal: op.consumidorFinal, cpfCnpj: r.recipient.taxId },
      pagamento: { formaRecebimento: { id: input.fiscalPayment.formaRecebimentoId }, meioPagamento: { id: input.fiscalPayment.meioPagamentoId }, parcelas: [] }, itens: products.map(p => ({ produto: { id: p.id }, quantidade: p.quantity, valorUnitario: p.unitPriceCents / 100 })) } };
}
