import { BadRequestException } from "@nestjs/common";

export const RECOVERY_TEMPLATE_DEFAULTS = {
  email: {
    subject: "{{storeName}} | Continue de onde parou",
    body: "Olá, {{buyerName}}!\n\nSua próxima escolha começa onde você parou. Acesse seu carrinho na {{storeName}} para revisar os itens e conferir as opções de entrega e pagamento antes de concluir a compra.\n\nContinue quando for o melhor momento para você.\n\n{{link}}\n\nAté breve,\nEquipe {{storeName}}",
  },
  whatsapp: { body: "Olá, {{buyerName}}! Aqui é da {{storeName}}.\n\nQuer continuar sua compra? Pelo link abaixo, você pode revisar seu carrinho e conferir as opções de entrega e pagamento antes de finalizar.\n\n{{link}}\n\nContinue no seu tempo. Será um prazer receber seu pedido." },
};

export interface RecoveryTemplateEdit {
  email: { subject: string; body: string };
  whatsapp: { body: string; revision: number };
}

export function validateRecoveryTemplateEdit(value: unknown): RecoveryTemplateEdit {
  if (!value || typeof value !== "object") throw new BadRequestException("invalid_template");
  const input = value as RecoveryTemplateEdit;
  const text = (value: unknown, max: number) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new BadRequestException("invalid_template_text");
    const stripped = value.replace(/\{\{(buyerName|storeName|link)\}\}/g, "");
    if (/[{}]/.test(stripped)) throw new BadRequestException("unsupported_template_variable");
    return value.trim();
  };
  const subject = text(input.email?.subject, 150);
  if (/[\r\n]/.test(subject)) throw new BadRequestException("invalid_email_subject");
  const emailBody = text(input.email?.body, 10000);
  const whatsappBody = text(input.whatsapp?.body, 1024);
  if (!emailBody.includes("{{link}}") || !whatsappBody.includes("{{link}}")) throw new BadRequestException("recovery_link_required");
  if (!Number.isSafeInteger(input.whatsapp?.revision) || input.whatsapp.revision < 1) throw new BadRequestException("invalid_template_revision");
  return { email: { subject, body: emailBody }, whatsapp: { body: whatsappBody, revision: input.whatsapp.revision } };
}

export function prepareRecoveryWhatsApp(body: string) {
  const variableMap: Record<string, string> = {};
  const sampleVariables: Record<string, string> = {};
  const positions = new Map<string, number>();
  const metaBody = body.replace(/\{\{(buyerName|storeName|link)\}\}/g, (_, name: string) => {
    if (!positions.has(name)) {
      const pos = positions.size + 1;
      positions.set(name, pos);
      variableMap[String(pos)] = name;
      sampleVariables[String(pos)] = name === "buyerName" ? "Ana" : name === "storeName" ? "Casa Aurora" : "https://loja.example/carrinho";
    }
    return `{{${positions.get(name)}}}`;
  });
  return { metaBody, variableMap, sampleVariables };
}

export function renderRecoveryText(body: string, variables: Record<string, string | number | undefined>) {
  return body.replace(/\{\{(buyerName|storeName|link)\}\}/g, (_, name: string) => String(variables[name] ?? (name === "buyerName" ? "Cliente" : name === "storeName" ? "nossa loja" : "")));
}
