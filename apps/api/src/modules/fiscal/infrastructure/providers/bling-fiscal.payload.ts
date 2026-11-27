import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProfileConfiguration, FiscalProfileRecord } from "../../domain/fiscal-profile.port.js";
import { readFiscalSnapshotEnvelope, type FiscalSnapshotRecord } from "../../domain/fiscal-sale-snapshot.port.js";
import { validateFiscalRecipient } from "../../domain/fiscal-recipient.js";
import { fiscalCalendarDate } from "../../domain/fiscal-payment-date.js";
export interface BlingFiscalOperation {
  departureDateBasis: "issued_at"; expectedDateBasis: "issued_at"; fretePorConta: 0 | 1 | 2 | 3 | 4 | 9; indicadorIe: 1 | 2 | 9;
  lojaId: number; crt: 1 | 2 | 3 | 4; cupomFiscal: number;
  products: Record<string, { productId: number; naturezaOperacaoId: number }>;
}
export interface BlingFiscalProfileConfiguration extends FiscalProfileConfiguration { operation: BlingFiscalOperation }
export interface BlingFiscalPayload extends Readonly<Record<string, unknown>> {
  kind: "bling_order_v1"; reference: string; profileVersionId: string; totalCents: number; recipientTaxId: string;
  emailOwner: string;
  payment?: { id: number; code: string; caut?: string; acquirerTaxId?: string; brandCode?: string };
  contact: Record<string, unknown>; order: Record<string, unknown>;
  products: { id: number; sku: string; ncm: string; origin: string; unit: string; natureId: number;
    taxQuery: Record<string, unknown>; expectedTax: Record<string, string | number> }[];
}
export function buildBlingFiscalPayload(input: { identity: FiscalIdentity; snapshot: FiscalSnapshotRecord; profile: FiscalProfileRecord; issuedAt: string; timeZone?: string }): BlingFiscalPayload {
  const { identity, snapshot, profile } = input; const config = profile.itemRules as BlingFiscalProfileConfiguration;
  const envelope = readFiscalSnapshotEnvelope(snapshot.items); const operation = config?.operation;
  if (!profile.confirmedAt || !profile.confirmedBy || profile.provider !== "bling" || profile.id !== envelope.profileVersionId || profile.merchantId !== identity.merchantId
    || snapshot.merchantId !== identity.merchantId || profile.environment !== identity.environment || snapshot.environment !== identity.environment || config.currency !== "BRL" || snapshot.currency !== "BRL"
    || !operation || operation.departureDateBasis !== "issued_at" || operation.expectedDateBasis !== "issued_at" || ![0, 1, 2, 3, 4, 9].includes(operation.fretePorConta) || ![1, 2, 9].includes(operation.indicadorIe)
    || !Number.isSafeInteger(operation.lojaId) || operation.lojaId <= 0 || ![1, 2, 3, 4].includes(operation.crt) || !Number.isInteger(operation.cupomFiscal)) throw new Error("fiscal_profile_configuration_required");
  if (!Number.isFinite(Date.parse(input.issuedAt)) || !Number.isFinite(snapshot.completedAt.getTime())) throw new Error("fiscal_issued_at_required");
  if (!envelope.lines.length || envelope.pendingLines.length || envelope.readinessCode) throw new Error("fiscal_snapshot_not_ready");
  const validation = validateFiscalRecipient(snapshot.recipient, ["name", "taxId", "address.street", "address.number", "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode"]);
  if (!validation.valid) throw new Error("fiscal_recipient_configuration_required");
  const r = validation.recipient; const a = r.address!;
  const products: BlingFiscalPayload["products"] = [];
  const items = envelope.lines.map(line => {
    const product = operation.products?.[line.sku]; const rule = config.items[line.sku];
    if (!product || !Number.isSafeInteger(product.productId) || product.productId <= 0 || !Number.isSafeInteger(product.naturezaOperacaoId) || product.naturezaOperacaoId <= 0
      || !rule || !/^\d{8}$/.test(rule.ncm) || !/^\d{4}$/.test(rule.cfop) || !/^[0-8]$/.test(rule.origin) || !rule.unit || !Object.keys(rule.taxes ?? {}).length
      || Object.keys(rule.taxes).some(key => !/^(icms|simples|pis|cofins|ipi)\.(cst|aliquota)$/.test(key))) throw new Error("fiscal_product_configuration_required");
    if (![line.grossCents, line.unitPriceCents, line.discountCents, line.shippingCents, line.totalCents].every(value => Number.isSafeInteger(value) && value >= 0)
      || line.quantity <= 0 || line.grossCents !== Math.round(line.quantity * line.unitPriceCents) || line.totalCents !== line.grossCents - line.discountCents + line.shippingCents) throw new Error("fiscal_amount_invalid");
    products.push({ id: product.productId, sku: line.sku, ncm: rule.ncm, origin: rule.origin, unit: rule.unit, natureId: product.naturezaOperacaoId,
      taxQuery: { tipoNota: 1, uf: a.state, municipio: { id: Number(a.cityCode) }, loja: { id: operation.lojaId }, crt: operation.crt, obterRegras: true,
        produto: { id: product.productId, valorUnitario: line.unitPriceCents / 100, cupomFiscal: operation.cupomFiscal, origem: Number(rule.origin), quantidade: line.quantity } },
      expectedTax: { cfop: Number(rule.cfop), ...rule.taxes } });
    return { codigo: line.sku, descricao: line.name, unidade: rule.unit, quantidade: line.quantity, valor: line.unitPriceCents / 100,
      produto: { id: product.productId }, naturezaOperacao: { id: product.naturezaOperacaoId } };
  });
  const totals = envelope.fiscalTotals;
  if (totals.subtotalCents !== envelope.lines.reduce((sum, line) => sum + line.grossCents, 0) || totals.discountCents !== envelope.lines.reduce((sum, line) => sum + line.discountCents, 0)
    || totals.shippingCents !== envelope.lines.reduce((sum, line) => sum + line.shippingCents, 0) || totals.totalCents !== envelope.lines.reduce((sum, line) => sum + line.totalCents, 0)) throw new Error("fiscal_totals_mismatch");
  const buyerEmail = validateFiscalRecipient({ email: envelope.buyerContacts?.email }, ["email"]);
  return { kind: "bling_order_v1", reference: identity.reference, profileVersionId: profile.id, recipientTaxId: r.taxId!, totalCents: totals.totalCents, products, emailOwner: envelope.policy.emailOwner,
    contact: { codigo: identity.reference + ":contact", nome: r.name, numeroDocumento: r.taxId, situacao: "A", tipo: r.taxId!.length === 11 ? "F" : "J", indicadorIe: operation.indicadorIe,
      ...(buyerEmail.valid ? { emailNotaFiscal: buyerEmail.recipient.email } : {}), endereco: { geral: { endereco: a.street, numero: a.number, complemento: a.complement, bairro: a.neighborhood, municipio: a.city, uf: a.state, cep: a.postalCode } } },
    order: { numeroLoja: identity.reference, loja: { id: operation.lojaId }, data: fiscalCalendarDate(snapshot.completedAt.toISOString(), input.timeZone ?? "UTC"), dataSaida: fiscalCalendarDate(input.issuedAt, input.timeZone ?? "UTC"), dataPrevista: fiscalCalendarDate(input.issuedAt, input.timeZone ?? "UTC"),
      desconto: { valor: totals.discountCents / 100, unidade: "REAL" }, transporte: { frete: totals.shippingCents / 100, fretePorConta: operation.fretePorConta }, itens: items, parcelas: [] } };
}
