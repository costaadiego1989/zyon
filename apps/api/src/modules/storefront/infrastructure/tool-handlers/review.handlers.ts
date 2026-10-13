import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { PrismaClient } from "@prisma/client";
import type { SubmitCustomerTestimonialUseCase } from "../../../catalog/application/use-cases/submit-customer-testimonial.use-case.js";
import type { SupportHandoffService } from "../../../support/application/support-handoff.service.js";

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
        const where: any = { merchantId: ctx.merchantId, moderationStatus: "approved" };
        if (productId) where.productId = productId;
        if (args.filter === "positive") where.rating = { gte: 4 };
        if (args.filter === "negative") where.rating = { lte: 2 };
        const product = productId ? await deps.prisma.product.findFirst({ where: { id: productId, merchantId: ctx.merchantId, isActive: true }, select: { name: true } }) : undefined;
        if (productId && !product) return { error: "product_not_found", reviews: [] };
        if (args.cursor && !await deps.prisma.productReview.findFirst({ where: { ...where, id: args.cursor }, select: { id: true } })) return { error: "review_cursor_invalid", reviews: [] };
        const [rows, stats] = await Promise.all([
          deps.prisma.productReview.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
            take: limit + 1,
          }),
          deps.prisma.productReview.aggregate({ where, _count: true, _avg: { rating: true } }),
        ]);
        const reviews = rows.slice(0, limit).map((r: any) => ({
          id: r.id,
          author: r.buyerName || "Cliente",
          rating: r.rating,
          text: r.text ?? r.body ?? "",
          date: r.createdAt?.toISOString?.()?.slice(0, 10) ?? "",
        }));
        return { reviews, productId, productName: product?.name ?? "", nextCursor: rows.length > limit ? rows[limit - 1].id : undefined,
          totalCount: stats._count, averageRating: Math.round((stats._avg.rating ?? 0) * 10) / 10 };
      } catch {
        return { reviews: [], totalCount: 0, averageRating: 0 };
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
        productId: args.productId,
        author: authorName,
        rating: args.rating,
        text: args.text,
        date: new Date().toISOString().slice(0, 10),
        status: "pending_moderation"
      };
    },

    getProductQuestions: async (args: any) => {
      const questions = await deps.prisma.productFaq.findMany({ where: { productId: args.productId, isPublished: true,
        product: { merchantId: ctx.merchantId, isActive: true } }, orderBy: [{ order: "asc" }, { id: "asc" }], take: 100 });
      return {
        questions: questions.map(q => ({ id: q.id, question: q.question, answer: q.answer })), totalCount: questions.length,
      };
    },

    createQuestion: async (args: any) => {
      const product = await deps.prisma.product.findFirst({ where: { id: args.productId, merchantId: ctx.merchantId, isActive: true }, select: { name: true } });
      if (!product) return { error: "product_not_found" };
      if (typeof args.question !== "string" || !args.question.trim() || args.question.length > 4000) return { error: "product_question_invalid" };
      if (!deps.supportHandoff) return { error: "product_question_service_unavailable" };
      const ticket = await deps.supportHandoff.createHandoff({ merchantId: ctx.merchantId, sessionId: ctx.conversationId ?? ctx.sessionId,
        buyerMessage: `Pergunta sobre ${product.name}: ${args.question.trim()}` });
      return {
        id: ticket.ticketId,
        productId: args.productId,
        question: args.question,
        author: args.authorName,
        date: new Date().toISOString().slice(0, 10),
        status: "awaiting_answer"
      };
    }
  };
}
