import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import type { PrismaClient } from "@prisma/client";

export interface SupportHandlerDeps {
  supportHandoff: SupportHandoffService;
  prisma: PrismaClient;
}

export function createSupportHandlers(deps: SupportHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "getFaq" | "escalateToHuman"> {
  return {
    getFaq: async (args: any) => {
      const settings = await deps.prisma.supportSetting.findUnique({
        where: { merchantId: ctx.merchantId },
        select: { faqItems: true },
      }).catch(() => null);
      const merchantFaq = Array.isArray(settings?.faqItems) ? settings.faqItems as Array<{ question: string; answer: string }> : [];
      const { DEFAULT_SUPPORT_FAQ } = await import("../../../support/domain/defaults/support-faq.defaults.js");
      const faqs = merchantFaq.length > 0 ? merchantFaq : DEFAULT_SUPPORT_FAQ;
      return { faqs: args.category ? faqs.slice(0, 3) : faqs };
    },

    escalateToHuman: async (args: any) => {
      const result = await deps.supportHandoff.createHandoff({
        merchantId: ctx.merchantId,
        sessionId: ctx.sessionId,
        buyerMessage: args.reason || "Solicitação de atendimento humano",
      });
      return {
        escalated: true,
        ticketId: result.ticketId,
        message: result.reply,
        reason: args.reason,
      };
    }
  };
}
