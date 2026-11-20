import type { FiscalProfileConfiguration, FiscalProfileRecord } from "../../domain/fiscal-profile.port.js";
import { readFiscalSnapshotEnvelope, type FiscalSnapshotRecord } from "../../domain/fiscal-sale-snapshot.port.js";
import { validateFiscalRecipient, type FiscalRecipient } from "../../domain/fiscal-recipient.js";

export interface FocusFiscalOperation {
  natureza_operacao: string; tipo_documento: number; finalidade_emissao: number; local_destino: number;
  consumidor_final: number; presenca_comprador: number; modalidade_frete: number; indicador_inscricao_estadual_destinatario: number;
}
export interface FocusFiscalProfileConfiguration extends FiscalProfileConfiguration { operation: FocusFiscalOperation }
/** issuedAt is persisted once at first issuance admission; completedAt remains the original sale time. */
export function buildFocusFiscalPayload(input: { snapshot: FiscalSnapshotRecord; profile: FiscalProfileRecord; issuerTaxId: string; issuedAt: string }): Record<string, unknown> {
  const { profile, snapshot } = input;
  if (!profile?.confirmedBy || !profile.confirmedAt || profile.provider !== "focus" || profile.merchantId !== snapshot?.merchantId || profile.environment !== snapshot.environment) throw new Error("fiscal_profile_configuration_required");
  const config = profile.itemRules as FocusFiscalProfileConfiguration;
  const operation = config?.operation;
  if (!operation || typeof operation.natureza_operacao !== "string" || !operation.natureza_operacao.trim()
    || ["tipo_documento", "finalidade_emissao", "local_destino", "consumidor_final", "presenca_comprador", "modalidade_frete", "indicador_inscricao_estadual_destinatario"].some(key => !Number.isInteger(operation[key as keyof FocusFiscalOperation]))) throw new Error("fiscal_operation_configuration_required");
  if (!input.issuedAt || !Number.isFinite(Date.parse(input.issuedAt))) throw new Error("fiscal_issued_at_required");
  const envelope = readFiscalSnapshotEnvelope(snapshot.items);
  if (!profile.id || envelope.profileVersionId !== profile.id || config.currency !== snapshot.currency || config.currency !== "BRL") throw new Error("fiscal_profile_configuration_mismatch");
  if (!envelope.lines.length || envelope.pendingLines.length || envelope.readinessCode) throw new Error("fiscal_snapshot_not_ready");
  const recipient = validateFiscalRecipient(snapshot.recipient, ["name", "taxId", "address.street", "address.number", "address.neighborhood", "address.city", "address.state", "address.postalCode"]);
  if (!recipient.valid) throw new Error("fiscal_recipient_configuration_required");
  const r = recipient.recipient as FiscalRecipient; const a = r.address!;
  const cents = (value: number) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error("fiscal_amount_invalid"); return value / 100; };
  const items = envelope.lines.map((line, index) => {
    const rule = config.items?.[line.sku];
    if (!rule || !/^\d{8}$/.test(rule.ncm) || !/^\d{4}$/.test(rule.cfop) || !/^[0-8]$/.test(rule.origin) || !rule.unit || !Object.keys(rule.taxes ?? {}).length) throw new Error("fiscal_item_configuration_required");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0 || line.grossCents !== Math.round(line.quantity * line.unitPriceCents)
      || line.totalCents !== line.grossCents - line.discountCents + line.shippingCents) throw new Error("fiscal_amount_invalid");
    return { ...rule.taxes, numero_item: index + 1, codigo_produto: line.sku, descricao: line.name,
      codigo_ncm: rule.ncm, cfop: rule.cfop, icms_origem: rule.origin, unidade_comercial: rule.unit, unidade_tributavel: rule.unit,
      quantidade_comercial: line.quantity, quantidade_tributavel: line.quantity, valor_unitario_comercial: cents(line.unitPriceCents), valor_unitario_tributavel: cents(line.unitPriceCents),
      valor_bruto: cents(line.grossCents), valor_desconto: cents(line.discountCents), valor_frete: cents(line.shippingCents) };
  });
  const totals = envelope.fiscalTotals;
  for (const [key, sum] of [["subtotalCents", envelope.lines.reduce((s, l) => s + l.grossCents, 0)], ["discountCents", envelope.lines.reduce((s, l) => s + l.discountCents, 0)],
    ["shippingCents", envelope.lines.reduce((s, l) => s + l.shippingCents, 0)], ["totalCents", envelope.lines.reduce((s, l) => s + l.totalCents, 0)]] as const) {
    if (totals[key] !== sum) throw new Error("fiscal_totals_mismatch");
  }
  const header = Object.fromEntries(["natureza_operacao", "tipo_documento", "finalidade_emissao", "local_destino", "consumidor_final", "presenca_comprador", "modalidade_frete", "indicador_inscricao_estadual_destinatario"]
    .map(key => [key, operation[key as keyof FocusFiscalOperation]]));
  const buyerEmail = validateFiscalRecipient({ email: envelope.buyerContacts?.email }, ["email"]);
  return { ...header, __zyonFiscalDelivery: { emailOwner: envelope.policy.emailOwner, ...(buyerEmail.valid ? { buyerEmail: buyerEmail.recipient.email } : {}) }, data_emissao: input.issuedAt,
    [input.issuerTaxId.length === 11 ? "cpf_emitente" : "cnpj_emitente"]: input.issuerTaxId,
    [r.taxId!.length === 11 ? "cpf_destinatario" : "cnpj_destinatario"]: r.taxId, nome_destinatario: r.name,
    logradouro_destinatario: a.street, numero_destinatario: a.number, complemento_destinatario: a.complement,
    bairro_destinatario: a.neighborhood, municipio_destinatario: a.city, uf_destinatario: a.state, cep_destinatario: a.postalCode,
    valor_produtos: cents(totals.subtotalCents), valor_desconto: cents(totals.discountCents), valor_frete: cents(totals.shippingCents), valor_total: cents(totals.totalCents), items };
}
