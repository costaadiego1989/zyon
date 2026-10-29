import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import {
  NPS_REPOSITORY,
  type NpsRepositoryPort,
  type NpsResponse,
  type CreateNpsResponseInput,
} from "../../domain/ports/nps-repository.port.js";

@Injectable()
export class PrismaNpsRepository implements NpsRepositoryPort {
  constructor(private prisma: PrismaClient) {}

  async create(input: CreateNpsResponseInput): Promise<NpsResponse> {
    // Classify
    const classification = this.classify(input.score);

    const response = await this.prisma.npsResponse.create({
      data: {
        merchantId: input.merchantId,
        buyerId: input.buyerId,
        orderId: input.orderId || null,
        score: input.score,
        feedback: input.feedback || null,
        classification,
      },
    });

    return this.mapToDomain(response);
  }

  async findById(merchantId: string, id: string): Promise<NpsResponse | null> {
    const response = await this.prisma.npsResponse.findFirst({
      where: { id, merchantId },
    });

    return response ? this.mapToDomain(response) : null;
  }

  async listByMerchant(
    merchantId: string,
    page?: number,
    pageSize?: number
  ): Promise<{ items: NpsResponse[]; total: number }> {
    const skip = ((page ?? 1) - 1) * (pageSize ?? 20);
    const take = pageSize ?? 20;

    const [responses, total] = await Promise.all([
      this.prisma.npsResponse.findMany({
        where: { merchantId },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.npsResponse.count({ where: { merchantId } }),
    ]);

    return {
      items: responses.map((r) => this.mapToDomain(r)),
      total,
    };
  }

  async countByClassification(
    merchantId: string,
    classification: "promoter" | "passive" | "detractor"
  ): Promise<number> {
    return this.prisma.npsResponse.count({
      where: { merchantId, classification },
    });
  }

  async averageScore(merchantId: string): Promise<number | null> {
    const result = await this.prisma.npsResponse.aggregate({
      where: { merchantId },
      _avg: { score: true },
    });

    return result._avg.score ?? null;
  }

  private classify(score: number): "promoter" | "passive" | "detractor" {
    if (score >= 9) return "promoter";
    if (score >= 7) return "passive";
    return "detractor";
  }

  private mapToDomain(raw: any): NpsResponse {
    return {
      id: raw.id,
      merchantId: raw.merchantId,
      buyerId: raw.buyerId,
      orderId: raw.orderId,
      score: raw.score,
      feedback: raw.feedback,
      classification: raw.classification,
      createdAt: raw.createdAt,
    };
  }
}
