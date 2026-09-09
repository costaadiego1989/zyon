import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { CHAT_COMPLETION_PORT, type ChatCompletionPort } from "../../../support/domain/ports/chat-completion.port.js";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../../merchant/domain/ports/merchant-repository.port.js";
import { validateRecoveryTemplateEdit } from "../../../whatsapp-templates/domain/recovery-template-content.js";
import { isSafeGeneratedMessage } from "../../../checkout/domain/types/safe-generated-message.js";

const PROMPT = `Crie um rascunho de recuperação de carrinho em português do Brasil para e-mail e WhatsApp.
Responda somente JSON: {"email":{"subject":"...","body":"..."},"whatsapp":{"body":"..."}}.
Os tokens de personalização são literais e serão preenchidos pelo sistema apenas no envio. Use um tom profissional, acolhedor e conciso, sem emojis.
Regras obrigatórias:
- Assunto: até 150 caracteres e uma linha, com {{storeName}}.
- E-mail: até 900 caracteres. WhatsApp: até 700 caracteres.
- Use {{buyerName}}, {{storeName}} e {{link}} exatamente assim nos dois corpos. Nenhuma outra variável.
- Não preencha as variáveis com dados reais. Não inclua URLs nem endereços de e-mail literais.
- Convide a revisar os itens do carrinho e as opções de entrega e pagamento, sem afirmar reserva ou disponibilidade.
- WhatsApp é um template MARKETING: inclua contexto claro entre as variáveis, comece e termine com palavras (não variáveis).
- Não use variáveis adjacentes, HTML, markdown ou linhas em branco consecutivas.
- Não prometa descontos, cupons, frete grátis, prazos, estoque, pagamento confirmado, urgência ou aprovação da Meta.
- Não peça dados pessoais, documentos, senhas ou dados de cartão.
- Não diga para responder SAIR: o sistema trata as preferências de contato no fluxo do comprador, não por esse comando.
O resultado será revisado pela loja antes de salvar. Não acrescente explicações ou estado de aprovação.`;

/** Produces an editable draft only. Saving and Meta approval belong to the existing lifecycle. */
@Injectable()
export class GenerateRecoveryTemplatesUseCase {
  constructor(
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
  ) {}

  async execute(merchantId: string) {
    const merchant = await this.merchants.getProfile(merchantId);
    if (!merchant) throw new NotFoundException("merchant_not_found");
    try {
      const reply = await this.chat.complete([
        { role: "system", content: PROMPT },
        { role: "user", content: JSON.stringify({ storeName: "{{storeName}}", buyerName: "{{buyerName}}", cartLink: "{{link}}" }) },
      ]);
      if (!reply) throw new Error("empty_generation");
      const raw = JSON.parse(reply.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_generation");
      const whatsapp = raw.whatsapp as Record<string, unknown> | undefined;
      const draft = validateRecoveryTemplateEdit({ email: raw.email, whatsapp: { body: whatsapp?.body, revision: 1 } });
      const bodies = [draft.email.body, draft.whatsapp.body];
      for (const body of bodies) {
        if (!body.includes("{{buyerName}}") || !body.includes("{{storeName}}")) throw new Error("identity_required");
      }
      if (!draft.email.subject.includes("{{storeName}}")) throw new Error("store_subject_required");
      for (const text of [draft.email.subject, ...bodies]) {
        if (!isSafeGeneratedMessage(text).safe || /https?:\/\/|www\.|<[^>]+>|\b\S+@\S+\b/i.test(text)) throw new Error("unsafe_generation");
        if (/\b(?:descontos?|cupons?|gr[aá]tis|gratuito|[uú]ltim[oa]s?|urgente|garantid[oa]|reservad[oa])\b|\d+\s*%|R\$|aprovad[oa].*Meta/i.test(text)) throw new Error("unauthorized_offer");
      }
      // Conservative template formatting; the lifecycle supplies positional variables and samples.
      if (/^\{\{|\}\}$|\}\}\s*\{\{|\t|\n{3,}/.test(draft.whatsapp.body)) throw new Error("invalid_meta_format");
      return { source: "ai" as const, email: draft.email, whatsapp: { body: draft.whatsapp.body } };
    } catch {
      // Never return platform defaults labelled as AI or mutate the saved revision on failure.
      throw new ServiceUnavailableException("recovery_template_generation_unavailable");
    }
  }
}
