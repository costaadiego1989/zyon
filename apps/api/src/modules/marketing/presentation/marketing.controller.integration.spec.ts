import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingHttpFixture } from "../marketing-http.fixture.js";

test("MKT-08/1 real HTTP rejects anonymous, forged and revoked sessions", async () => {
  const f = await marketingHttpFixture();
  try {
    assert.equal((await f.request("/contacts", { role: null })).status, 401);
    assert.equal(
      (await f.request("/contacts", { token: `${f.users.owner.token}x` }))
        .status,
      401
    );
    assert.equal((await f.request("/contacts")).status, 200);
    await f.jwt.revoke(f.users.owner.token);
    assert.equal((await f.request("/contacts")).status, 401);
  } finally {
    await f.cleanup();
  }
});

test("MKT-08/2 current billing plan gates every route and downgrade preserves data", async () => {
  const f = await marketingHttpFixture();
  try {
    const c = f.contact();
    await f.repository.transaction(f.merchantId, "seed", (tx) =>
      tx.saveContact(c)
    );
    assert.equal((await f.request(`/contacts/${c.id}`)).status, 200);
    await f.db.merchantBillingSubscription.update({
      where: { merchantId: f.merchantId },
      data: { planKey: "starter" },
    });
    for (const path of [
      "/contacts",
      "/conversations",
      "/campaigns",
      "/settings",
    ]) {
      const result = await f.request(path);
      assert.equal(result.status, 403, path);
      assert.equal((await result.json()).code, "marketing_plan_required");
    }
    assert.equal(
      (
        await f.repository.transaction(f.merchantId, "read", (tx) =>
          tx.contact(c.id)
        )
      )?.id,
      c.id
    );
    await f.db.merchantBillingSubscription.update({
      where: { merchantId: f.merchantId },
      data: { planKey: "scale" },
    });
    assert.equal((await f.request(`/contacts/${c.id}`)).status, 200);
  } finally {
    await f.cleanup();
  }
});

test("MKT-08/3 staff reads and moves own contacts but cannot approve or configure sends", async () => {
  const f = await marketingHttpFixture();
  try {
    const c = f.contact();
    await f.repository.transaction(f.merchantId, "seed", (tx) =>
      tx.saveContact(c)
    );
    assert.equal((await f.request("/contacts", { role: "staff" })).status, 200);
    const move = await f.request(`/contacts/${c.id}/stage`, {
      role: "staff",
      method: "PATCH",
      body: {
        stage: "interested",
        reason: "Interesse confirmado no atendimento",
        version: 0,
      },
    });
    assert.equal(move.status, 200);
    assert.equal((await move.json()).stage, "interested");
    assert.equal(
      (
        await f.request("/settings", {
          role: "staff",
          method: "PATCH",
          body: {},
        })
      ).status,
      403
    );
    assert.equal(
      (
        await f.request(`/campaigns/${randomUUID()}/approve`, {
          role: "staff",
          method: "POST",
          body: { version: 1 },
        })
      ).status,
      403
    );
    const persisted = await f.contacts.detail(f.merchantId, c.id);
    assert.equal(persisted.contact.stage, "interested");
    assert.equal(persisted.history[0].authorId, f.users.staff.id);
  } finally {
    await f.cleanup();
  }
});

test("MKT-08/4 tenant and input validation reject foreign IDs and supplied merchant scope", async () => {
  const f = await marketingHttpFixture();
  try {
    assert.equal((await f.request(`/contacts/${randomUUID()}`)).status, 404);
    assert.equal((await f.request("/contacts/not-a-uuid")).status, 400);
    // The existing global tenant interceptor rejects scope overrides before
    // DTO validation. Preserve its explicit 403 contract.
    const scope = await f.request("/contacts?merchantId=foreign");
    assert.equal(scope.status, 403);
    assert.equal((await scope.json()).message, "tenant_mismatch_query");
    assert.equal((await f.request("/contacts?limit=5000")).status, 400);
    const body = {
      name: "Promoção local",
      body: "Ofertas para você. Responda PARAR para sair.",
      segment: {},
      budgetCents: 1000,
      maxUnitCostCents: 10,
    };
    assert.equal(
      (
        await f.request("/campaigns", {
          method: "POST",
          body: { ...body, merchantId: "foreign" },
        })
      ).status,
      403
    );
    const created = await f.request("/campaigns", {
      role: "admin",
      method: "POST",
      body,
    });
    assert.equal(created.status, 201);
    const campaign = await created.json();
    assert.equal(campaign.merchantId, f.merchantId);
    assert.equal(campaign.status, "draft");
    const stored = await f.repository.transaction(f.merchantId, "read", (tx) =>
      tx.campaign(campaign.id)
    );
    assert.equal(stored?.body, body.body);
    assert.equal(stored?.approvedAt, null);
  } finally {
    await f.cleanup();
  }
});
