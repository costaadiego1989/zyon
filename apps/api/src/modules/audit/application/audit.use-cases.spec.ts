import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ListAuditEventsUseCase,
  RecordAuditEventUseCase,
} from "./audit.use-cases.js";
import type {
  AuditRepository,
  MerchantAuditEvent,
} from "../domain/ports/audit-repository.port.js";

describe("merchant audit events", () => {
  it("records the authenticated actor without accepting tenant input", async () => {
    const repository = new InMemoryAuditRepository();
    const record = new RecordAuditEventUseCase(repository);

    const event = await record.execute({
      principal: {
        kind: "service",
        tenantId: "mrc_a",
        credentialId: "key_1",
        environment: "test",
        scopes: ["audit:read"],
      },
      action: "http.post",
      resourceType: "orders",
      resourceId: "ord_1",
      correlationId: "corr_1",
    });

    assert.equal(event.merchantId, "mrc_a");
    assert.equal(event.actorType, "service");
    assert.equal(event.actorId, "key_1");
  });

  it("returns opaque cursor pagination", async () => {
    const repository = new InMemoryAuditRepository();
    const record = new RecordAuditEventUseCase(repository);
    for (let index = 0; index < 3; index += 1) {
      await record.execute({
        principal: {
          kind: "human",
          tenantId: "mrc_a",
          userId: `usr_${index}`,
          email: "owner@example.com",
          role: "owner",
        },
        action: "http.put",
        resourceType: "configuration",
      });
    }

    const list = new ListAuditEventsUseCase(repository);
    const first = await list.execute({ merchantId: "mrc_a", limit: 2 });
    assert.equal(first.data.length, 2);
    assert.ok(first.nextCursor);
    const second = await list.execute({
      merchantId: "mrc_a",
      limit: 2,
      cursor: first.nextCursor!,
    });
    assert.equal(second.data.length, 1);
  });
});

class InMemoryAuditRepository implements AuditRepository {
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
  }): Promise<MerchantAuditEvent[]> {
    return this.rows
      .filter((row) => row.merchantId === input.merchantId)
      .sort((left, right) =>
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
