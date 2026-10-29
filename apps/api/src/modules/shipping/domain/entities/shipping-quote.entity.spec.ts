import test from "node:test";
import assert from "node:assert/strict";
import { ShippingQuoteEntity } from "./shipping-quote.entity.js";

test("ShippingQuoteEntity.create assigns id, default expiry, and empty results", () => {
  const created = new Date("2026-05-01T12:00:00.000Z");
  const quote = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    created_at: created,
    ttl_seconds: 60
  });

  const snap = quote.snapshot();
  assert.ok(snap.id.length > 0, "id is generated");
  assert.equal(snap.session_id, "sess_1");
  assert.equal(snap.merchant_id, "mrc_1");
  assert.equal(snap.destination_zip, "01310-100");
  assert.equal(snap.quote_key, "");
  assert.deepEqual(snap.results, []);
  assert.equal(snap.selected_carrier_key, null);
  assert.equal(snap.created_at, created.toISOString());
  assert.equal(snap.expires_at, new Date(created.getTime() + 60_000).toISOString());
});

test("ShippingQuoteEntity.create defaults ttl when not provided (uses engine default)", () => {
  const quote = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    created_at: new Date("2026-05-01T12:00:00.000Z")
  });
  const created = new Date(quote.snapshot().created_at).getTime();
  const expires = new Date(quote.snapshot().expires_at).getTime();
  assert.ok(expires > created, "expires_at is later than created_at");
  assert.ok(expires - created >= 60_000, "default ttl is at least 60s (engine default)");
});

test("ShippingQuoteEntity.addResults accumulates carrier options and is pure", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100"
  });
  const q2 = q.addResults([
    { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
  ]);
  const q3 = q2.addResults([
    { carrier_key: "sedex", label: "Sedex", price: 3000, eta_days: 2, is_free: false }
  ]);

  // immutability: original aggregate unchanged
  assert.equal(q.snapshot().results.length, 0);
  assert.equal(q2.snapshot().results.length, 1);
  assert.equal(q3.snapshot().results.length, 2);

  assert.deepEqual(q3.snapshot().results.map((r) => r.carrier_key), ["pac", "sedex"]);
});

test("ShippingQuoteEntity.selectCarrier returns updated aggregate with selected_carrier_key", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100"
  }).addResults([
    { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
  ]);

  const updated = q.selectCarrier("pac");
  assert.equal(updated.snapshot().selected_carrier_key, "pac");
  // original is unchanged (immutable)
  assert.equal(q.snapshot().selected_carrier_key, null);
});

test("ShippingQuoteEntity.selectCarrier throws when carrier not in results", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100"
  }).addResults([
    { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
  ]);

  assert.throws(
    () => q.selectCarrier("unknown"),
    /shipping_carrier_not_in_quote/
  );
});

test("ShippingQuoteEntity.selectCarrier throws when quote is expired", () => {
  const past = new Date("2024-01-01T00:00:00.000Z");
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    created_at: past,
    ttl_seconds: 1
  }).addResults([
    { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
  ]);

  const later = new Date(past.getTime() + 10_000);
  assert.throws(() => q.selectCarrier("pac", later), /shipping_quote_expired/);
});

test("ShippingQuoteEntity.isExpired is true after expiry and false before", () => {
  const past = new Date("2026-05-01T12:00:00.000Z");
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    created_at: past,
    ttl_seconds: 30
  });

  assert.equal(q.isExpired(new Date(past.getTime() + 5_000)), false);
  assert.equal(q.isExpired(new Date(past.getTime() + 60_000)), true);
});

test("ShippingQuoteEntity.recordCreated emits shipping.quote.created envelope", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    quote_key: "abc123"
  });
  q.recordCreated();
  const events = q.pullEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, "shipping.quote.created");
  assert.equal(events[0]!.merchant_id, "mrc_1");
  assert.equal(events[0]!.producer, "shipping");
  assert.equal((events[0]!.payload as { quote_id: string }).quote_id, q.id);
});

test("ShippingQuoteEntity.selectCarrier emits shipping.method.selected envelope", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100"
  }).addResults([
    { carrier_key: "pac", label: "PAC", price: 1500, eta_days: 5, is_free: false }
  ]);
  const updated = q.selectCarrier("pac");
  const events = updated.pullEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, "shipping.method.selected");
  const payload = events[0]!.payload as { carrier_key: string; price: number; is_free: boolean };
  assert.equal(payload.carrier_key, "pac");
  assert.equal(payload.price, 1500);
  assert.equal(payload.is_free, false);
});

test("ShippingQuoteEntity.pullEvents drains and clears event buffer", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100"
  });
  q.recordCreated();
  const first = q.pullEvents();
  const second = q.pullEvents();
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, "events buffer drained after pullEvents()");
});

test("ShippingQuoteEntity.rehydrate restores existing snapshot", () => {
  const snap = {
    id: "qid_1",
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100",
    quote_key: "k1",
    results: [{ carrier_key: "pac", label: "PAC", price: 100, eta_days: 3, is_free: false }],
    selected_carrier_key: "pac",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-01T00:30:00.000Z"
  };
  const q = ShippingQuoteEntity.rehydrate(snap);
  assert.equal(q.id, "qid_1");
  assert.equal(q.quote_key, "k1");
  assert.equal(q.snapshot().selected_carrier_key, "pac");
});

test("ShippingQuoteEntity.snapshot returns a defensive copy of results", () => {
  const q = ShippingQuoteEntity.create({
    session_id: "sess_1",
    merchant_id: "mrc_1",
    destination_zip: "01310-100"
  }).addResults([
    { carrier_key: "pac", label: "PAC", price: 100, eta_days: 3, is_free: false }
  ]);

  const snap = q.snapshot();
  snap.results.push({ carrier_key: "ghost", label: "Ghost", price: 0, eta_days: 1, is_free: false });
  assert.equal(q.snapshot().results.length, 1, "internal results unchanged after snapshot mutation");
});
