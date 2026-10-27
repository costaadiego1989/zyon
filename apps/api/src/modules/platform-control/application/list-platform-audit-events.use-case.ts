import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  presentPlatformAuditEvent,
  type PlatformAuditCursor,
} from "../domain/platform-audit.js";
import {
  PLATFORM_AUDIT_REPOSITORY,
  type PlatformAuditQuery,
  type PlatformAuditReadAudit,
  type PlatformAuditRepository,
} from "../domain/ports/platform-audit-repository.port.js";

const MAX_PERIOD_DAYS = 366;
const MAX_CURSOR_LENGTH = 512;

type ListPlatformAuditEventsInput = {
  cursor?: unknown;
  limit?: unknown;
  action?: unknown;
  actor_operator_id?: unknown;
  from?: unknown;
  to?: unknown;
};

type AuditReadContext = Omit<PlatformAuditReadAudit,
  "returnedItems" | "limit" | "actionFilterApplied" | "actorFilterApplied" | "dateRangeApplied" | "cursorApplied">;

@Injectable()
export class ListPlatformAuditEventsUseCase {
  constructor(
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly auditEvents: PlatformAuditRepository,
  ) {}

  async execute(input: ListPlatformAuditEventsInput, audit: AuditReadContext) {
    const query = normalizeQuery(input);
    const page = await this.auditEvents.list(query);
    await this.auditEvents.recordRead({
      ...audit,
      returnedItems: page.items.length,
      limit: query.limit,
      actionFilterApplied: Boolean(query.action),
      actorFilterApplied: Boolean(query.actorOperatorId),
      dateRangeApplied: Boolean(query.from),
      cursorApplied: Boolean(query.cursor),
    });

    return {
      generated_at: new Date().toISOString(),
      filters: presentFilters(query),
      coverage: {
        audit_event_storage: {
          status: "available" as const,
          description: "Eventos operacionais do controle de plataforma persistidos para consulta interna permissionada.",
        },
      },
      items: page.items.map(presentPlatformAuditEvent),
      next_cursor: page.nextCursor ? encodeCursor(page.nextCursor, fingerprint(query)) : null,
    };
  }
}

function normalizeQuery(input: ListPlatformAuditEventsInput): PlatformAuditQuery {
  const action = optionalAction(input.action);
  const actorOperatorId = optionalIdentifier(input.actor_operator_id, "platform_audit_invalid_actor_operator_id");
  const period = optionalUtcPeriod(input.from, input.to);
  const filters = { action, actorOperatorId, ...period };
  return {
    limit: pageSize(input.limit),
    ...(action ? { action } : {}),
    ...(actorOperatorId ? { actorOperatorId } : {}),
    ...period,
    ...(input.cursor === undefined ? {} : { cursor: decodeCursor(input.cursor, fingerprint(filters)) }),
  };
}

function pageSize(value: unknown): number {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^(?:[1-9]\d?|100)$/.test(value)) {
    throw new Error("platform_audit_invalid_limit");
  }
  return Number(value);
}

function optionalAction(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9:._-]{1,160}$/.test(value)) {
    throw new Error("platform_audit_invalid_action");
  }
  return value;
}

function optionalIdentifier(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error(code);
  return value;
}

function optionalUtcPeriod(fromValue: unknown, toValue: unknown): Pick<PlatformAuditQuery, "from" | "to"> {
  if (fromValue === undefined && toValue === undefined) return {};
  if (fromValue === undefined || toValue === undefined) throw new Error("platform_audit_invalid_period");
  const from = utcInstant(fromValue, "platform_audit_invalid_from");
  const to = utcInstant(toValue, "platform_audit_invalid_to");
  if (from >= to || to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error("platform_audit_invalid_period");
  }
  return { from, to };
}

function utcInstant(value: unknown, code: string): Date {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(code);
  }
  const date = new Date(normalized);
  const canonical = normalized.includes(".")
    ? normalized.replace(/\.(\d{1,3})Z$/, (_value, milliseconds: string) => `.${milliseconds.padEnd(3, "0")}Z`)
    : normalized.replace("Z", ".000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString() !== canonical) throw new Error(code);
  return date;
}

function fingerprint(query: Pick<PlatformAuditQuery, "action" | "actorOperatorId" | "from" | "to">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      action: query.action ?? null,
      actorOperatorId: query.actorOperatorId ?? null,
      from: query.from?.toISOString() ?? null,
      to: query.to?.toISOString() ?? null,
    }))
    .digest("base64url");
}

function encodeCursor(cursor: PlatformAuditCursor, filterFingerprint: string): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    occurredAt: cursor.occurredAt.toISOString(),
    id: cursor.id,
    filterFingerprint,
  })).toString("base64url");
}

function decodeCursor(value: unknown, expectedFingerprint: string): PlatformAuditCursor {
  if (typeof value !== "string" || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("platform_audit_invalid_cursor");
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isCursor(decoded) || decoded.filterFingerprint !== expectedFingerprint) {
      throw new Error("platform_audit_invalid_cursor");
    }
    return {
      occurredAt: utcInstant(decoded.occurredAt, "platform_audit_invalid_cursor"),
      id: optionalIdentifier(decoded.id, "platform_audit_invalid_cursor")!,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "platform_audit_invalid_cursor") throw error;
    throw new Error("platform_audit_invalid_cursor");
  }
}

function isCursor(value: unknown): value is {
  version: number;
  occurredAt: unknown;
  id: unknown;
  filterFingerprint: unknown;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1
    && typeof candidate.occurredAt === "string"
    && typeof candidate.id === "string"
    && typeof candidate.filterFingerprint === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(candidate.filterFingerprint)
    && Object.keys(candidate).length === 4;
}

function presentFilters(query: PlatformAuditQuery) {
  return {
    action: query.action ?? null,
    actor_operator_id: query.actorOperatorId ?? null,
    range: query.from && query.to ? {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      timezone: "UTC" as const,
      end_exclusive: true,
    } : null,
  };
}
