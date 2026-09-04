import type { PrismaClient } from "@prisma/client";
import type { CustomerIntentRecord } from "@zyon/shared-types";
import type { IntentMemoryRepositoryPort } from "../../domain/ports/intent-memory-repository.port.js";
import {
  toDomainRecord,
  toPrismaCreateRecord,
  toPrismaUpdateRecord
} from "./prisma-intent-memory.converters.js";

export class PrismaIntentMemoryRepository implements IntentMemoryRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(record: CustomerIntentRecord): Promise<void> {
    await this.prisma.customerIntentRecord.upsert({
      where: {
        id: record.id || "placeholder"
      },
      create: {
        id: record.id,
        ...toPrismaCreateRecord(record)
      },
      update: toPrismaUpdateRecord(record)
    });
  }

  async getLatest(
    merchantId: string,
    globalUserId: string
  ): Promise<CustomerIntentRecord | null> {
    const row = await this.prisma.customerIntentRecord.findFirst({
      where: {
        merchantId,
        globalUserId
      },
      orderBy: {
        generatedAt: "desc"
      },
      take: 1
    });
    return row ? toDomainRecord(row) : null;
  }

  async findByMerchantId(merchantId: string): Promise<CustomerIntentRecord[]> {
    const rows = await this.prisma.customerIntentRecord.findMany({
      where: {
        merchantId
      },
      orderBy: {
        generatedAt: "desc"
      }
    });
    return rows.map(toDomainRecord);
  }
}
