import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingTestFixture } from "../marketing-test-fixture.js";

test("MKT-01/5 contact identity and event receipt remain unique under concurrency", async () => {
  const f = marketingTestFixture();
  try {
    const key = "wa:example";
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.repository.transaction(f.merchantId, "identity", async (tx) => {
          const current = await tx.contactByIdentity(key);
          if (current) return current.id;
          const created = f.contact({ identityKey: key });
          await tx.saveContact(created);
          return created.id;
        })
      )
    );
    assert.equal(new Set(ids).size, 1);
    const receipt = await f.repository.transaction(
      f.merchantId,
      "event",
      async (tx) => [
        await tx.receipt("event-1", f.now),
        await tx.receipt("event-1", f.now),
      ]
    );
    assert.deepEqual(receipt, [true, false]);
  } finally {
    await f.cleanup();
  }
});
test("MKT-08/5 cross-tenant reads and writes cannot reveal or move contacts", async () => {
  const f = marketingTestFixture();
  try {
    const c = f.contact();
    await f.repository.transaction(f.merchantId, "contact", (tx) =>
      tx.saveContact(c)
    );
    assert.equal(
      await f.repository.transaction("another-store", "contact", (tx) =>
        tx.contact(c.id)
      ),
      null
    );
    await assert.rejects(
      f.repository.transaction("another-store", "contact", (tx) =>
        tx.saveContact(c)
      ),
      /marketing_tenant_mismatch/
    );
    assert.equal(
      (
        await f.repository.transaction(f.merchantId, "contact", (tx) =>
          tx.contact(c.id)
        )
      )?.id,
      c.id
    );
  } finally {
    await f.cleanup();
  }
});
test("MKT-07/1 pagination and totals query the entire tenant base", async () => {
  const f = marketingTestFixture();
  try {
    await f.repository.transaction(f.merchantId, "identity", async (tx) => {
      for (let i = 0; i < 5; i++)
        await tx.saveContact(
          f.contact({
            name: `Buyer ${i}`,
            stage: i === 4 ? "interested" : "new",
          })
        );
    });
    const page = await f.repository.transaction(f.merchantId, "read", (tx) =>
      tx.contacts({ limit: 2, offset: 0 })
    );
    assert.equal(page.items.length, 2);
    assert.equal(page.total, 5);
    const searched = await f.repository.transaction(
      f.merchantId,
      "read",
      (tx) => tx.contacts({ search: "Buyer 4", limit: 2, offset: 0 })
    );
    assert.equal(searched.total, 1);
    assert.equal(searched.items[0].stage, "interested");
  } finally {
    await f.cleanup();
  }
});
test("MKT-06/6 independent dispatches share a durable contact frequency reservation", async () => {
  const f = marketingTestFixture();
  try {
    const results = await Promise.all(
      ["recovery", "campaign"].map((key) =>
        f.repository.transaction(f.merchantId, key, (tx) =>
          tx.reserveCommercial("same-contact", key, f.now, 24, 1)
        )
      )
    );
    assert.equal(results.filter(Boolean).length, 1);
  } finally {
    await f.cleanup();
  }
});
test("MKT-09/1 transactions roll back a partially written historical contact", async () => {
  const f = marketingTestFixture();
  const id = randomUUID();
  try {
    await assert.rejects(
      f.repository.transaction(f.merchantId, "history", async (tx) => {
        await tx.saveContact(f.contact({ id }));
        throw new Error("historical_failure");
      }),
      /historical_failure/
    );
    assert.equal(
      await f.repository.transaction(f.merchantId, "read", (tx) =>
        tx.contact(id)
      ),
      null
    );
  } finally {
    await f.cleanup();
  }
});
