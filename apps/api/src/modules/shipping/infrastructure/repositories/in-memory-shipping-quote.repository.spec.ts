import test from "node:test";
import assert from "node:assert/strict";
import { ShippingQuoteEntity } from "../../domain/entities/shipping-quote.entity.js";
import { InMemoryShippingQuoteRepository } from "./in-memory-shipping-quote.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

function build(seed: { merchant_id?: string; session_id?: string; quote_key?: string; ttl_seconds?: number; created_at?: Date } = {}) {
  return ShippingQuoteEntity.create({
    session_id: seed.session_id ?? "sess_1",
    merchant_id: seed.merchant_id ?? "mrc_1",
    destination_zip: "01310-100",
    quote_key: seed.quote_key ?? "key_1",
    ttl_seconds: seed.ttl_seconds ?? 60_000,
    created_at: seed.created_at ?? new Date()
  });
}

test("InMemoryShippingQuoteRepository.saveWithEvents persists and emits outbox events", async () => {
  const outbox = new InMemoryOutboxRepository();
  const repo = new InMemoryShippingQuoteRepository(outbox);
  const q = build();
  q.recordCreated();

  await repo.saveWithEvents(q);
  const stored = await repo.findById(q.id, "mrc_1");
  assert.ok(stored);
  assert.equal(stored!.id, q.id);

  const events = outbox.listOutbox("mrc_1");
  assert.equal(events.length, 1, "outbox receives the created event");
  assert.equal(events[0]!.event_type, "shipping.quote.created");
});

test("InMemoryShippingQuoteRepository.findById enforces merchant boundary", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const q = build();
  await repo.saveWithEvents(q);

  const ok = await repo.findById(q.id, "mrc_1");
  const leak = await repo.findById(q.id, "mrc_other");
  assert.ok(ok);
  assert.equal(leak, null, "findById must not leak across tenants");
});

test("InMemoryShippingQuoteRepository.findBySession returns latest non-empty for session+merchant", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());

  const t0 = new Date("2026-05-01T12:00:00.000Z");
  const t1 = new Date("2026-05-01T12:10:00.000Z");

  await repo.saveWithEvents(
    build({ session_id: "sess_A", merchant_id: "mrc_1", created_at: t0 })
  );
  await repo.saveWithEvents(
    build({ session_id: "sess_A", merchant_id: "mrc_1", created_at: t1 })
  );
  // different session, ignore
  await repo.saveWithEvents(
    build({ session_id: "sess_B", merchant_id: "mrc_1", created_at: t1 })
  );
  // different merchant, ignore
  await repo.saveWithEvents(
    build({ session_id: "sess_A", merchant_id: "mrc_2", created_at: t1 })
  );

  const latest = await repo.findBySession("sess_A", "mrc_1");
  assert.ok(latest);
  assert.equal(latest!.snapshot().created_at, t1.toISOString());
});

test("InMemoryShippingQuoteRepository.findBySession returns null when no match", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  await repo.saveWithEvents(build());
  const out = await repo.findBySession("nope", "mrc_1");
  assert.equal(out, null);
});

test("InMemoryShippingQuoteRepository.findValidByKey skips expired quotes and returns latest valid", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());

  const past = new Date("2026-05-01T12:00:00.000Z");
  await repo.saveWithEvents(
    build({
      quote_key: "k1",
      created_at: past,
      ttl_seconds: 1 // expires 1s after past
    })
  );
  await repo.saveWithEvents(
    build({
      quote_key: "k1",
      created_at: new Date(past.getTime() + 10_000),
      ttl_seconds: 60_000
    })
  );

  const now = new Date(past.getTime() + 100); // both technically expired? no, second one has 60s
  const found = await repo.findValidByKey("k1", "mrc_1", now);
  assert.ok(found);
  assert.ok(found!.snapshot().expires_at > now.toISOString());
});

test("InMemoryShippingQuoteRepository.findValidByKey returns null for empty key", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  const out = await repo.findValidByKey("", "mrc_1");
  assert.equal(out, null);
});

test("InMemoryShippingQuoteRepository.findValidByKey returns null when nothing matches", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  await repo.saveWithEvents(build({ quote_key: "k_other" }));
  const out = await repo.findValidByKey("k_missing", "mrc_1");
  assert.equal(out, null);
});

test("InMemoryShippingQuoteRepository.findValidByKey is scoped per merchant", async () => {
  const repo = new InMemoryShippingQuoteRepository(new InMemoryOutboxRepository());
  await repo.saveWithEvents(build({ quote_key: "shared", merchant_id: "mrc_1" }));

  const own = await repo.findValidByKey("shared", "mrc_1");
  const foreign = await repo.findValidByKey("shared", "mrc_2");
  assert.ok(own);
  assert.equal(foreign, null);
});
