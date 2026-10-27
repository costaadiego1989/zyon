import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { OptimisticConcurrencyError } from "../../../shared/http/http-contract.errors.js";
import type {
  CreateInstallationInput,
  InstallationRepository,
  ListInstallationsInput,
  ListInstallationsResult,
  MerchantInstallation,
  ReportInstallationHealthInput,
  UpdateInstallationInput,
} from "../domain/ports/installation-repository.port.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

@Injectable()
export class PrismaInstallationRepository implements InstallationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: ListInstallationsInput): Promise<ListInstallationsResult> {
    const limit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const cursor = decodeCursor(input.cursor);

    const rows = await this.prisma.merchantInstallation.findMany({
      where: {
        merchantId: input.merchantId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ environment: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map(toInstallation);
    const last = data.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

    return { data, nextCursor, hasMore };
  }

  async get(
    merchantId: string,
    installationId: string,
  ): Promise<MerchantInstallation | undefined> {
    const row = await this.prisma.merchantInstallation.findFirst({
      where: { id: installationId, merchantId },
    });
    return row ? toInstallation(row) : undefined;
  }

  async create(
    input: CreateInstallationInput,
  ): Promise<MerchantInstallation> {
    const row = await this.prisma.merchantInstallation.create({
      data: {
        merchantId: input.merchantId,
        name: input.name,
        environment: input.environment,
        widgetVersion: input.widgetVersion,
        allowedOrigins: input.allowedOrigins,
      },
    });
    return toInstallation(row);
  }

  async update(
    input: UpdateInstallationInput,
  ): Promise<MerchantInstallation> {
    const result = await this.prisma.merchantInstallation.updateMany({
      where: {
        id: input.installationId,
        merchantId: input.merchantId,
        updatedAt: new Date(input.expectedUpdatedAt),
      },
      data: {
        name: input.name,
        status: input.status,
        widgetVersion: input.widgetVersion,
        allowedOrigins: input.allowedOrigins,
      },
    });
    if (result.count !== 1) throw new OptimisticConcurrencyError();
    const row = await this.prisma.merchantInstallation.findFirstOrThrow({
      where: {
        id: input.installationId,
        merchantId: input.merchantId,
      },
    });
    return toInstallation(row);
  }

  async reportHealth(
    input: ReportInstallationHealthInput,
  ): Promise<MerchantInstallation> {
    const now = new Date();
    const result = await this.prisma.merchantInstallation.updateMany({
      where: {
        id: input.installationId,
        merchantId: input.merchantId,
      },
      data: {
        status: input.healthy ? "active" : "degraded",
        widgetVersion: input.widgetVersion,
        lastSeenAt: now,
        lastHealthAt: now,
        lastErrorCode: input.healthy ? null : input.errorCode ?? "widget_unhealthy",
      },
    });
    if (result.count !== 1) throw new OptimisticConcurrencyError();
    const row = await this.prisma.merchantInstallation.findFirstOrThrow({
      where: {
        id: input.installationId,
        merchantId: input.merchantId,
      },
    });
    return toInstallation(row);
  }
}

function toInstallation(row: {
  id: string;
  merchantId: string;
  name: string;
  environment: string;
  status: string;
  widgetVersion: string;
  allowedOrigins: string[];
  lastHealthAt: Date | null;
  lastSeenAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MerchantInstallation {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    environment: row.environment as MerchantInstallation["environment"],
    status: row.status as MerchantInstallation["status"],
    widgetVersion: row.widgetVersion,
    allowedOrigins: row.allowedOrigins,
    lastHealthAt: row.lastHealthAt?.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString(),
    lastErrorCode: row.lastErrorCode ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type InstallationCursor = { createdAt: string; id: string };

function encodeCursor(cursor: InstallationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): InstallationCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<InstallationCursor>;
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return undefined;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}
