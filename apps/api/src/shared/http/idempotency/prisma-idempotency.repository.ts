import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type IdempotencyClaim,
  type IdempotencyClaimInput,
  type IdempotencyReplay,
  type IdempotencyRepository,
} from "./idempotency.repository.js";

export class PrismaIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(input: IdempotencyClaimInput): Promise<IdempotencyClaim> {
    const existing = await this.find(input.merchantId, input.idempotencyKey);
    if (existing && existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.httpIdempotencyRecord.deleteMany({
        where: {
          id: existing.id,
          merchantId: input.merchantId,
          expiresAt: { lte: new Date() },
        },
      });
    } else if (existing) {
      return claimFromExisting(existing, input.requestFingerprint);
    }

    try {
      const created = await this.prisma.httpIdempotencyRecord.create({
        data: {
          merchantId: input.merchantId,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: input.requestFingerprint,
          method: input.method,
          route: input.route,
          expiresAt: input.expiresAt,
        },
      });
      return { outcome: "acquired", recordId: created.id };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.find(input.merchantId, input.idempotencyKey);
      if (!raced) throw error;
      return claimFromExisting(raced, input.requestFingerprint);
    }
  }

  async complete(
    recordId: string,
    merchantId: string,
    requestFingerprint: string,
    replay: IdempotencyReplay,
  ): Promise<void> {
    const result = await this.prisma.httpIdempotencyRecord.updateMany({
      where: {
        id: recordId,
        merchantId,
        requestFingerprint,
        state: "processing",
      },
      data: {
        state: "completed",
        statusCode: replay.statusCode,
        responseBody: toJson(replay.responseBody),
        responseHeaders: replay.responseHeaders,
      },
    });
    if (result.count !== 1) {
      throw new Error("idempotency_record_completion_failed");
    }
  }

  async release(
    recordId: string,
    merchantId: string,
    requestFingerprint: string,
  ): Promise<void> {
    await this.prisma.httpIdempotencyRecord.deleteMany({
      where: {
        id: recordId,
        merchantId,
        requestFingerprint,
        state: "processing",
      },
    });
  }

  private find(merchantId: string, idempotencyKey: string) {
    return this.prisma.httpIdempotencyRecord.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId,
          idempotencyKey,
        },
      },
    });
  }
}

function claimFromExisting(
  existing: {
    state: string;
    requestFingerprint: string;
    statusCode: number | null;
    responseBody: unknown;
    responseHeaders: unknown;
  },
  requestFingerprint: string,
): IdempotencyClaim {
  if (existing.requestFingerprint !== requestFingerprint) {
    return { outcome: "payload_mismatch" };
  }
  if (existing.state !== "completed" || existing.statusCode === null) {
    return { outcome: "in_progress" };
  }
  return {
    outcome: "replay",
    replay: {
      statusCode: existing.statusCode,
      responseBody: existing.responseBody,
      responseHeaders: asStringRecord(existing.responseHeaders),
    },
  };
}

function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
