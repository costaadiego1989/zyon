import { BadRequestException } from "@nestjs/common";
import { buildCatalog, categoryFor } from "./catalog/template-catalog.js";
import { WHATSAPP_TEMPLATE_TYPES, type WhatsAppTemplateType } from "./catalog/template-types.js";
import { RECOVERY_TEMPLATE_DEFAULTS, prepareRecoveryWhatsApp, validateRecoveryTemplateEdit, type RecoveryTemplateEdit } from "./recovery-template-content.js";

export function salesTemplateType(type: string): WhatsAppTemplateType {
  if (!(WHATSAPP_TEMPLATE_TYPES as readonly string[]).includes(type)) throw new BadRequestException("unsupported_template_type");
  return type as WhatsAppTemplateType;
}
export function salesDefaults(type: string) {
  if (type === "cart_recovery") return RECOVERY_TEMPLATE_DEFAULTS;
  const def = buildCatalog()[salesTemplateType(type)];
  return { email: { subject: `{{storeName}} | ${def.label}`, body: def.freeformBody }, whatsapp: { body: def.freeformBody } };
}
const samples: Record<string, string> = { merchantName: "Loja Exemplo", planName: "Growth", expiresAt: "21/09/2026, 10:00", dashboardLink: "https://app.zyon-payments.com.br/#billing-plans", buyerName: "Ana", storeName: "Loja Exemplo", productName: "Camiseta", orderId: "PED-123", trackingCode: "BR123456789", couponBlock: "Cupom VOLTE10: 10% de desconto", coupon: "VOLTE10", discount: "10%", link: "https://loja.exemplo/pedido" };
export function prepareSalesWhatsApp(type: string, body: string) {
  salesTemplateType(type);
  if (type === "cart_recovery") return { ...prepareRecoveryWhatsApp(body), category: "MARKETING" };
  const positions = new Map<string, number>();
  const variableMap: Record<string, string> = {};
  const sampleVariables: Record<string, string> = {};
  const metaBody = body.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(samples, name)) throw new BadRequestException("unsupported_template_variable");
    if (!positions.has(name)) positions.set(name, positions.size + 1);
    const pos = String(positions.get(name));
    variableMap[pos] = name;
    sampleVariables[pos] = samples[name];
    return `{{${pos}}}`;
  });
  if (/[{}]/.test(metaBody.replace(/\{\{\d+\}\}/g, ""))) throw new BadRequestException("unsupported_template_variable");
  const promotional = /\{\{(?:couponBlock|coupon|discount)\}\}/.test(body);
  return { metaBody, variableMap, sampleVariables, category: promotional ? "MARKETING" : categoryFor(salesTemplateType(type)) };
}
export function validateSalesEdit(type: string, value: unknown): RecoveryTemplateEdit {
  salesTemplateType(type);
  if (type === "cart_recovery") return validateRecoveryTemplateEdit(value);
  if (!value || typeof value !== "object") throw new BadRequestException("invalid_template");
  const input = value as RecoveryTemplateEdit;
  const text = (value: unknown, max: number) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException("invalid_template_text");
    prepareSalesWhatsApp(type, value);
    return value.trim();
  };
  const subject = text(input.email?.subject, 150);
  if (/[\r\n]/.test(subject)) throw new BadRequestException("invalid_email_subject");
  if (!Number.isSafeInteger(input.whatsapp?.revision) || input.whatsapp.revision < 1) throw new BadRequestException("invalid_template_revision");
  return { email: { subject, body: text(input.email?.body, 10000) }, whatsapp: { body: text(input.whatsapp?.body, 1024), revision: input.whatsapp.revision } };
}
