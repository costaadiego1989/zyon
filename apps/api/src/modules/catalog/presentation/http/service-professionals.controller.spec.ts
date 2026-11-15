import assert from "node:assert/strict";
import test from "node:test";
import { ServiceProfessionalsController } from "./service-professionals.controller.js";

test("T19", async t => {
  await t.test("public change event follows persisted identity and version without copying profile data", async () => {
    const persisted = { id: "professional", version: 3, isActive: true, isPublished: true, publicProfile: { description: "Public profile" } };
    let committed = false;
    const events: unknown[] = [];
    const controller = new ServiceProfessionalsController({ create: async () => { committed = true; return persisted; } } as never,
      { publish: async (event: unknown) => { assert.equal(committed, true); events.push(event); } } as never);
    const request = { tenantPrincipal: { kind: "human" as const, tenantId: "merchant", userId: "owner", role: "owner" as const, email: "private@example.test" } };
    assert.equal(await controller.create(request, {} as never), persisted);
    assert.deepEqual(events, [{ eventType: "service.professional.changed", schemaVersion: 1, merchantId: "merchant", payload: { professionalId: "professional", version: 3, publicationState: "published" } }]);
  });
  await t.test("invalid mutation envelopes fail before persistence", async () => {
    const controller = new ServiceProfessionalsController({ update: async () => assert.fail("invalid envelope must not write"), deactivate: async () => assert.fail("invalid envelope must not write") } as never);
    for (const body of [null, [], "invalid"]) await assert.rejects(controller.update({} as never, "id", body as never), /invalid_professional/);
    await assert.rejects(controller.deactivate({} as never, "id", { expectedVersion: 1, force: true } as never), /invalid_professional/);
  });
});
