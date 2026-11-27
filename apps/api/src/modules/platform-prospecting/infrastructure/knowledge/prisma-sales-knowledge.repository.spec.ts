import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectCrmFixture } from "../../../../../tests/prospect-crm-fixture.js";
import { PrismaSalesKnowledgeRepository } from "./prisma-sales-knowledge.repository.js";

test("PROS-19 AC1 saves immutable, attributed drafts and exposes none as active knowledge", async () => {
  const f = await createProspectCrmFixture();
  const actor = { operatorId: "operator", correlationId: "review" };
  try {
    const repo = new PrismaSalesKnowledgeRepository(f.prisma);
    const input = { clientRequestId: "draft-1", expectedVersion: 0, title: "Product", sourceRef: "Zyon handbook", validFrom: "2026-01-01T00:00:00.000Z", validUntil: null, facts: [{id:"chat",subject:"Chat",predicate:"feature",value:"Chat in the panel."}] };
    const v1 = await repo.save("handbook", input, actor);
    assert.equal(v1.version, 1);
    assert.equal(v1.state, "draft");
    assert.equal(v1.draft[0].sourceId, "handbook");
    assert.equal(v1.draft[0].publicationVersion, 1);
    assert.deepEqual(await repo.save("handbook", input, actor), v1);
    const edit = { ...input, expectedVersion:1, clientRequestId:"draft-2", title:"New handbook" };
    const v2 = await repo.save("handbook", edit, actor);
    assert.equal(v2.version, 2);
    await assert.rejects(repo.save("handbook", { ...edit, clientRequestId:"stale" }, actor), /version_conflict/);
    assert.deepEqual(await repo.active(new Date()), []);
    assert.equal((await repo.find("handbook"))?.title, "New handbook");
    const rows = await f.prisma.salesKnowledgePublication.findMany({ orderBy:{version:"asc"} });
    assert.deepEqual(rows.map(r=>[r.title,r.sourceRef,r.state]), [["Product","Zyon handbook","draft"],["New handbook","Zyon handbook","draft"]]);
    assert.equal(rows[0].id, v1.draft[0].publicationId);
    assert.deepEqual(await f.prisma.prospectAuditEvent.findMany({select:{actorOperatorId:true,resourceVersion:true},orderBy:{resourceVersion:"asc"}}), [1,2].map(resourceVersion=>({actorOperatorId:"operator", resourceVersion})));
    await assert.rejects(repo.save("handbook",{...edit, expectedVersion:2, clientRequestId:"invalid",validUntil:input.validFrom},actor), /invalid_/);
    assert.equal(await f.prisma.salesKnowledgePublication.count(), 2);
  } finally { await f.close(); }
});
