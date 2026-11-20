import { createHash } from "node:crypto";
import type { FiscalIdentity } from "../../domain/fiscal-provider.js";
import type { FiscalProfileConfiguration, FiscalProfileRecord } from "../../domain/fiscal-profile.port.js";
import { readFiscalSnapshotEnvelope, type FiscalSnapshotRecord } from "../../domain/fiscal-sale-snapshot.port.js";
import { validateFiscalRecipient } from "../../domain/fiscal-recipient.js";
export interface OmieFiscalOperation {
  etapa: "10" | "20" | "30" | "40"; codigoParcela: string; codigoCenarioImpostos: number; codigoCategoria: string; codigoContaCorrente: number;
  modalidadeFrete: string; contribuinte: "S" | "N"; indPresenca: string; indIntermediario: "0" | "1"; timeZone: string;
  cnpjIntermediario?: string; identIntermediario?: string; products: Record<string, { productId: number }>;
}
export interface OmieFiscalProfileConfiguration extends FiscalProfileConfiguration { operation: OmieFiscalOperation }
export interface OmieFiscalPayload extends Readonly<Record<string, unknown>> {
  kind: "omie_order_v1"; reference: string; profileVersionId: string; totalCents: number; contact: Record<string, unknown>; order: Record<string, unknown>;
  timeZone: string; stockOwner: string; emailOwner: string; sendEmail: boolean; products: { id: number; sku: string; ncm: string; origin: string; unit: string }[];
}
export function omieDate(instant: string, timeZone: string) {
  if (!Number.isFinite(Date.parse(instant))) throw new Error("fiscal_time_invalid");
  try { return new Intl.DateTimeFormat("pt-BR", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant)); }
  catch { throw new Error("fiscal_timezone_configuration_required"); }
}
export function fiscalObjectFingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical) : input && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function buildOmieFiscalPayload(input: { identity: FiscalIdentity; snapshot: FiscalSnapshotRecord; profile: FiscalProfileRecord; issuedAt: string; sendEmail: boolean; fiscalPayment: { code: string; description?: string; nsu?: string } }): OmieFiscalPayload {
  const { identity, snapshot, profile } = input; const envelope = readFiscalSnapshotEnvelope(snapshot.items); const config = profile.itemRules as OmieFiscalProfileConfiguration; const op = config?.operation;
  if (!profile.confirmedAt || !profile.confirmedBy || profile.provider !== "omie" || profile.id !== envelope.profileVersionId || profile.merchantId !== identity.merchantId || snapshot.merchantId !== identity.merchantId
    || profile.environment !== identity.environment || snapshot.environment !== identity.environment || config.currency !== "BRL" || snapshot.currency !== "BRL" || identity.reference.length > 60 || identity.reference.length + 8 > 60
    || !op || !["10", "20", "30", "40"].includes(op.etapa) || !op.codigoParcela || op.codigoParcela === "999" || !Number.isSafeInteger(op.codigoCenarioImpostos) || op.codigoCenarioImpostos <= 0
    || !op.codigoCategoria || !Number.isSafeInteger(op.codigoContaCorrente) || op.codigoContaCorrente <= 0 || !["S", "N"].includes(op.contribuinte)
    || !["0", "1", "2", "3", "4", "9"].includes(op.modalidadeFrete) || !["1", "2", "3", "4", "5", "9"].includes(op.indPresenca) || !["0", "1"].includes(op.indIntermediario)) throw new Error("fiscal_profile_configuration_required");
  if (op.indIntermediario === "1" && (!op.cnpjIntermediario || !op.identIntermediario)) throw new Error("fiscal_intermediary_configuration_required");
  if (!/^\d{2}$/.test(input.fiscalPayment.code) || input.fiscalPayment.code === "99" && !input.fiscalPayment.description) throw new Error("fiscal_payment_metadata_required");
  if (!envelope.lines.length || envelope.pendingLines.length || envelope.readinessCode || !["zyon", "provider"].includes(envelope.policy.stockOwner)
    || input.sendEmail && (envelope.policy.emailOwner !== "provider" || !envelope.buyerContacts?.email)) throw new Error("fiscal_snapshot_not_ready");
  const validation = validateFiscalRecipient(snapshot.recipient, ["name", "taxId", "address.street", "address.number", "address.neighborhood", "address.city", "address.state", "address.postalCode", "address.cityCode", "address.countryCode"]);
  if (!validation.valid) throw new Error("fiscal_recipient_configuration_required"); const r = validation.recipient; const a = r.address!;
  const products: OmieFiscalPayload["products"] = [];
  const det = envelope.lines.map((line, index) => {
    const rule = config.items[line.sku]; const product = op.products[line.sku];
    if (!rule || !product || !Number.isSafeInteger(product.productId) || product.productId <= 0 || !/^\d{8}$/.test(rule.ncm) || !/^\d{4}$/.test(rule.cfop) || !/^[0-8]$/.test(rule.origin) || !rule.unit || !Object.keys(rule.taxes ?? {}).length) throw new Error("fiscal_product_configuration_required");
    const imposto: Record<string, Record<string, string | number>> = {};
    for (const [path, value] of Object.entries(rule.taxes)) {
      const parts = path.split("."); const group = parts[0]!; const key = parts[1]!;
      if (parts.length !== 2 || !["icms_sn", "icms", "icms_st", "pis_padrao", "cofins_padrao", "ipi"].includes(group) || !/^(cod_sit_trib_|origem_|aliq_)[a-z_]+$/.test(key)
        || typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("fiscal_tax_configuration_required");
      (imposto[group] ??= {})[key] = value;
    }
    if (![line.unitPriceCents, line.grossCents, line.discountCents, line.shippingCents, line.totalCents].every(value => Number.isSafeInteger(value) && value >= 0)
      || line.quantity <= 0 || line.grossCents !== Math.round(line.unitPriceCents * line.quantity) || line.totalCents !== line.grossCents - line.discountCents + line.shippingCents) throw new Error("fiscal_amount_invalid");
    products.push({ id: product.productId, sku: line.sku, ncm: rule.ncm, origin: rule.origin, unit: rule.unit });
    return { ide: { codigo_item_integracao: "line_" + index }, produto: { codigo_produto: product.productId, codigo: line.sku, descricao: line.name, cfop: rule.cfop, ncm: rule.ncm, unidade: rule.unit,
      quantidade: line.quantity, valor_unitario: line.unitPriceCents / 100, tipo_desconto: "V", valor_desconto: line.discountCents / 100, reservado: "N" }, imposto,
      inf_adic: { nao_movimentar_estoque: envelope.policy.stockOwner === "zyon" ? "S" : "N", nao_gerar_financeiro: "S" } };
  });
  const totals = envelope.fiscalTotals;
  if (totals.subtotalCents !== envelope.lines.reduce((s, l) => s + l.grossCents, 0) || totals.discountCents !== envelope.lines.reduce((s, l) => s + l.discountCents, 0)
    || totals.shippingCents !== envelope.lines.reduce((s, l) => s + l.shippingCents, 0) || totals.totalCents !== envelope.lines.reduce((s, l) => s + l.totalCents, 0)) throw new Error("fiscal_totals_mismatch");
  return { kind: "omie_order_v1", reference: identity.reference, profileVersionId: profile.id, totalCents: totals.totalCents, timeZone: op.timeZone, stockOwner: envelope.policy.stockOwner, emailOwner: envelope.policy.emailOwner, sendEmail: input.sendEmail, products,
    contact: { codigo_cliente_integracao: identity.reference + ":contact", razao_social: r.name, cnpj_cpf: r.taxId, contribuinte: op.contribuinte, endereco: a.street, endereco_numero: a.number,
      complemento: a.complement ?? "", bairro: a.neighborhood, estado: a.state, cidade: a.cityCode, cidade_ibge: a.cityCode, cep: a.postalCode, codigo_pais: a.countryCode, pesquisar_cep: "N" },
    order: { cabecalho: { codigo_pedido_integracao: identity.reference, data_previsao: omieDate(input.issuedAt, op.timeZone), quantidade_itens: det.length, etapa: op.etapa,
      codigo_parcela: op.codigoParcela, codigo_cenario_impostos: op.codigoCenarioImpostos, nao_gerar_boleto: "S" }, det,
      frete: { modalidade: op.modalidadeFrete, valor_frete: totals.shippingCents / 100 }, informacoes_adicionais: { codigo_categoria: op.codigoCategoria, codigo_conta_corrente: op.codigoContaCorrente,
        enviar_email: input.sendEmail ? "S" : "N", enviar_pix: "N", ...(input.sendEmail ? { utilizar_emails: envelope.buyerContacts.email } : {}),
        meio_pagamento: input.fiscalPayment.code, ...(input.fiscalPayment.nsu ? { nsu: input.fiscalPayment.nsu } : {}), ...(input.fiscalPayment.description ? { descr_meio_pagamento: input.fiscalPayment.description } : {}),
        outros_detalhes: { cIndicadorOd: op.indPresenca, cIndicadorIntOd: op.indIntermediario,
          ...(op.indIntermediario === "1" ? { cCnpjIntOd: op.cnpjIntermediario, cIdentificadorIntOd: op.identIntermediario } : {}) } } } };
}
