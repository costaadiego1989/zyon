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
import { InMemoryAuditRepository } from "../infrastructure/in-memory-audit.repository.js";

describe("merchant audit events", () => {
  it("records the authenticated actor without accepting tenant input", async () => {
    const repository = new InMemoryAuditRepository();
    const record = new RecordAuditEventUseCase(repository);

    const event = await record.execute({
      merchantId: "mrc_a",
      actor: { type: "service", id: "key_1" },
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
        merchantId: "mrc_a",
        actor: { type: "human", id: `usr_${index}` },
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

  it("AUD-M1: filters by action and resourceType", async () => {
    const repository = new InMemoryAuditRepository();
    const record = new RecordAuditEventUseCase(repository);
    await record.execute({
      merchantId: "mrc_a",
      actor: { type: "human", id: "usr_1" },
      action: "http.post",
      resourceType: "orders",
    });
    await record.execute({
      merchantId: "mrc_a",
      actor: { type: "human", id: "usr_1" },
      action: "http.put",
      resourceType: "configuration",
    });

    const list = new ListAuditEventsUseCase(repository);
    const result = await list.execute({
      merchantId: "mrc_a",
      action: "http.post",
    });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.resourceType, "orders");
  });
});
