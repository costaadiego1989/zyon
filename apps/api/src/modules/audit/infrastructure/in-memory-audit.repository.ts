import type {
  AuditRepository,
  MerchantAuditEvent,
} from "../domain/ports/audit-repository.port.js";

/**
 * Test double only. Runtime persistence is Prisma (see project invariants).
 * Constructed directly in specs, never wired into module roots.
 * (AUD-L4: Add InMemoryAuditRepository for unit tests)
 */
export class InMemoryAuditRepository implements AuditRepository {
  private readonly rows: MerchantAuditEvent[] = [];

  async record(
    event: Omit<MerchantAuditEvent, "id" | "occurredAt">,
  ): Promise<MerchantAuditEvent> {
    const row: MerchantAuditEvent = {
      ...event,
      id: `aud_${this.rows.length + 1}`,
      occurredAt: new Date(Date.now() + this.rows.length).toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async list(input: {
    merchantId: string;
    limit: number;
    cursor?: { occurredAt: string; id: string };
    action?: string;
    resourceType?: string;
    actorId?: string;
    since?: string;
    until?: string;
  }): Promise<MerchantAuditEvent[]> {
    return this.rows
      .filter((row) => row.merchantId === input.merchantId)
      .filter((row) => !input.action || row.action === input.action)
      .filter((row) => !input.resourceType || row.resourceType === input.resourceType)
      .filter((row) => !input.actorId || row.actorId === input.actorId)
      .filter((row) => !input.since || row.occurredAt >= input.since)
      .filter((row) => !input.until || row.occurredAt <= input.until)
      .sort(
        (left, right) =>
          right.occurredAt.localeCompare(left.occurredAt) ||
          right.id.localeCompare(left.id),
      )
      .filter(
        (row) =>
          !input.cursor ||
          row.occurredAt < input.cursor.occurredAt ||
          (row.occurredAt === input.cursor.occurredAt &&
            row.id < input.cursor.id),
      )
      .slice(0, input.limit);
  }
}
