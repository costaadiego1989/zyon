import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { PrismaClient } from "@prisma/client";
import type { SubmitCustomerTestimonialUseCase } from "../../../catalog/application/use-cases/submit-customer-testimonial.use-case.js";
import type { SupportHandoffService } from "../../../support/application/support-handoff.service.js";
import { readPublicProductReviews } from "../../../catalog/infrastructure/repositories/public-product-reviews.reader.js";

export interface ReviewHandlerDeps {
  prisma: PrismaClient;
  submitTestimonial?: SubmitCustomerTestimonialUseCase;
  supportHandoff?: SupportHandoffService;
}

export function createReviewHandlers(deps: ReviewHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "getReviews" | "createReview" | "getProductQuestions" | "createQuestion"> {
  return {
    getReviews: async (args: any) => {
      const productId = args.productId;
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
      try {
        const product = productId ? await deps.prisma.product.findFirst({ where: { id: productId, merchantId: ctx.merchantId, isActive: true }, select: { name: true } }) : undefined;
        if (productId && !product) return { error: "product_not_found", reviews: [] };
        const result = await readPublicProductReviews(deps.prisma, { merchantId: ctx.merchantId, productId,
          filter: args.filter, cursor: args.cursor, limit });
        return { ...result, productId, productName: product?.name ?? "" };
      } catch {
        return { error: "reviews_unavailable" };
      }
    },

    createReview: async (args: any) => {
      const authorName = args.authorName || ctx.buyer?.name;
      if (!authorName || !ctx.buyer?.globalUserId) {
        return {
          error: "Identifique-se e informe seu nome para enviar a avaliação.",
          requiresIdentification: true,
        };
      }
      if (!deps.submitTestimonial) return { error: "review_service_unavailable" };
      const review = await deps.submitTestimonial.execute({ merchantId: ctx.merchantId, productId: args.productId,
        authorName, body: args.text, rating: args.rating, buyerId: ctx.buyer.globalUserId });
      return {
        id: review.id,
        productId: review.productId,
        author: authorName,
        rating: args.rating,
        text: args.text,
        date: new Date().toISOString().slice(0, 10),
        status: "pending_moderation"
      };
    },

    getProductQuestions: async (args: any) => {
      const product = await deps.prisma.product.findFirst({ where: { id: args.productId, merchantId: ctx.merchantId, isActive: true }, select: { id: true, name: true } });
      if (!product) return { error: "product_not_found" };
      if (args.filter === "mine" || args.filter === "unanswered") return { error: "product_question_history_unavailable",
        message: "O histórico pessoal de perguntas ainda não está disponível por aqui. Acompanhe seu protocolo no atendimento da loja. As perguntas respondidas são públicas, não uma lista das suas perguntas." };
      const questions = await deps.prisma.productFaq.findMany({ where: { productId: args.productId, isPublished: true,
        locale: "pt-BR", product: { merchantId: ctx.merchantId, isActive: true } }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 100 });
      return {
        productId: product.id, productName: product.name, scope: "public_answered", filter: "answered",
        questions: questions.map(q => ({ id: q.id, question: q.question, answer: q.answer })), totalCount: questions.length,
      };
    },

    createQuestion: async (args: any) => {
      const product = await deps.prisma.product.findFirst({ where: { id: args.productId, merchantId: ctx.merchantId, isActive: true }, select: { id: true, name: true } });
      if (!product) return { error: "product_not_found" };
      if (typeof args.question !== "string" || !args.question.trim() || args.question.length > 4000) return { error: "product_question_invalid" };
      if (!deps.supportHandoff) return { error: "product_question_service_unavailable" };
      const intake = `Pergunta sobre ${product.name}: ${args.question.trim()}`;
      const ticket = await deps.supportHandoff.createHandoff({ merchantId: ctx.merchantId, sessionId: ctx.conversationId ?? ctx.sessionId,
        buyerId: ctx.buyer?.globalUserId, buyerMessage: intake, initialMessage: intake });
      return {
        id: ticket.ticketId,
        productId: product.id,
        question: args.question,
        author: ctx.buyer?.name || args.authorName,
        date: new Date().toISOString().slice(0, 10),
        status: "awaiting_answer"
      };
    }
  };
}
