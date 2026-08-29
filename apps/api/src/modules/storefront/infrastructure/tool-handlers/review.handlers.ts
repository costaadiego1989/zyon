import type { StoreToolHandlers } from "../../domain/tools/types.js";
import type { ToolRequestContext } from "../../domain/tools/tool-context.js";
import type { PrismaClient } from "@prisma/client";

export interface ReviewHandlerDeps {
  prisma: PrismaClient;
}

export function createReviewHandlers(deps: ReviewHandlerDeps, ctx: ToolRequestContext): Pick<StoreToolHandlers, "getReviews" | "createReview" | "getProductQuestions" | "createQuestion"> {
  return {
    getReviews: async (args: any) => {
      const productId = args.productId;
      const limit = args.limit ?? 10;
      try {
        const where: any = { merchantId: ctx.merchantId, moderationStatus: "approved" };
        if (productId) where.productId = productId;
        const [rows, total] = await Promise.all([
          deps.prisma.productReview.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
          }),
          deps.prisma.productReview.count({ where }),
        ]);
        const reviews = rows.map((r: any) => ({
          id: r.id,
          author: r.buyerName || "Cliente",
          rating: r.rating,
          text: r.text,
          date: r.createdAt?.toISOString?.()?.slice(0, 10) ?? "",
        }));
        const avg = reviews.length > 0
          ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length
          : 0;
        return { reviews, totalCount: total, averageRating: Math.round(avg * 10) / 10 };
      } catch {
        return { reviews: [], totalCount: 0, averageRating: 0 };
      }
    },

    createReview: async (args: any) => {
      const authorName = args.authorName || ctx.buyer?.name;
      const authorPhone = args.authorPhone || ctx.buyer?.phone;
      if (!authorName || !authorPhone) {
        return {
          error: "Para criar uma avaliação, preciso do seu nome e telefone. Pode informar?",
          requiresIdentification: true,
        };
      }
      const phoneDigits = (authorPhone as string).replace(/\D/g, "");
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        return {
          error: "Telefone inválido. Informe um número com DDD (10 ou 11 dígitos).",
          requiresIdentification: true,
        };
      }
      return {
        id: `rev_${Date.now()}`,
        productId: args.productId,
        author: authorName,
        phone: phoneDigits,
        rating: args.rating,
        text: args.text,
        date: new Date().toISOString().slice(0, 10),
        status: "pending_moderation"
      };
    },

    getProductQuestions: async (args: any) => {
      return {
        questions: [
          { id: "q_1", question: "Serve para uso profissional?", answer: "Sim, é indicado para uso profissional.", author: "Carlos M.", date: "2026-08-12" },
          { id: "q_2", question: "Vem com garantia?", answer: "Sim, 12 meses de garantia.", author: "Paula R.", date: "2026-08-09" },
        ],
        totalCount: 2
      };
    },

    createQuestion: async (args: any) => {
      return {
        id: `q_${Date.now()}`,
        productId: args.productId,
        question: args.question,
        author: args.authorName,
        date: new Date().toISOString().slice(0, 10),
        status: "awaiting_answer"
      };
    }
  };
}
