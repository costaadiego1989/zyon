import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";

export interface BuyerReviewItem {
  id: string;
  productName: string;
  rating: number;
  body: string | null;
  status: string;
  createdAt: Date;
}

@Injectable()
export class ListBuyerReviewsUseCase {
  private readonly logger = new Logger(ListBuyerReviewsUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  async execute(globalUserId: string): Promise<BuyerReviewItem[]> {
    const reviews = await this.prisma.productReview.findMany({
      where: { buyerId: globalUserId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        product: { select: { name: true } },
      },
    });

    return reviews.map((r) => ({
      id: r.id,
      productName: (r.product as { name?: string })?.name ?? "Produto",
      rating: r.rating,
      body: r.body ?? r.text ?? null,
      status: r.moderationStatus ?? (r.approved ? "approved" : "pending"),
      createdAt: r.createdAt,
    }));
  }
}
