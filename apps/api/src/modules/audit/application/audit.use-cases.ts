import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import {
  AUDIT_REPOSITORY,
  type AuditCursor,
  type AuditRepository,
  type MerchantAuditEvent,
} from "../domain/ports/audit-repository.port.js";

@Injectable()
export class RecordAuditEventUseCase {
  constructor(
    @Inject(AUDIT_REPOSITORY)
    private readonly repository: AuditRepository,
  ) {}

  execute(input: {
    principal: TenantPrincipal;
    action: string;
    resourceType: string;
    resourceId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<MerchantAuditEvent> {
    return this.repository.record({
      merchantId: input.principal.tenantId,
      actorType: input.principal.kind,
      actorId:
        input.principal.kind === "human"
          ? input.principal.userId
          : input.principal.credentialId,
      action: required(input.action, "audit_action"),
      resourceType: required(input.resourceType, "audit_resource_type"),
      resourceId: optional(input.resourceId),
      correlationId: optional(input.correlationId),
      metadata: input.metadata ?? {},
    });
  }
}

@Injectable()
export class ListAuditEventsUseCase {
  constructor(
    @Inject(AUDIT_REPOSITORY)
    private readonly repository: AuditRepository,
  ) {}

  async execute(input: {
    merchantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    data: MerchantAuditEvent[];
    nextCursor: string | null;
  }> {
    const limit = clampLimit(input.limit);
    const rows = await this.repository.list({
      merchantId: required(input.merchantId, "merchant_id"),
      limit: limit + 1,
      cursor: decodeCursor(input.cursor),
    });
    const data = rows.slice(0, limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ occurredAt: last.occurredAt, id: last.id })
          : null,
    };
  }
}

function clampLimit(limit?: number): number {
  if (!Number.isInteger(limit)) return 50;
  return Math.max(1, Math.min(limit!, 100));
}

function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value?: string): AuditCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<AuditCursor>;
    if (
      typeof parsed.occurredAt !== "string" ||
      Number.isNaN(new Date(parsed.occurredAt).getTime()) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid_cursor");
    }
    return { occurredAt: parsed.occurredAt, id: parsed.id };
  } catch {
    throw new BadRequestException("cursor_invalid");
  }
}

function required(value: string, code: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${code}_required`);
  return normalized;
}

function optional(value?: string): string | undefined {
  return value?.trim() || undefined;
}
