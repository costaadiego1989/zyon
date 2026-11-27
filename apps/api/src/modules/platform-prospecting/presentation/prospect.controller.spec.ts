import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectingFixture } from "../../../../tests/prospecting-fixture.js";
import { createProspectCrmFixture } from "../../../../tests/prospect-crm-fixture.js";
import { PrismaProspectRepository } from "../infrastructure/crm/prisma-prospect.repository.js";
import { ProspectService } from "../application/crm/prospect.service.js";
import { ProspectController } from "./prospect.controller.js";

test("PROS-08 AC3 guards every prospect route and rejects incompatible transitions with no partial persisted changes", async () => {
  const f = await createProspectCrmFixture(); let reads = 0; let unavailable = false;
  class ObservedRepository extends PrismaProspectRepository { override async list(...args: Parameters<PrismaProspectRepository["list"]>) { reads++; if (unavailable) throw new Error("database_unavailable"); return super.list(...args); } }
  const repo = new ObservedRepository(f.prisma, f.directory); const service = new ProspectService(repo);
  const http = await createProspectingFixture({ controllers: [ProspectController], providers: [{ provide: ProspectService, useValue: service }] });
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)", [http.operators.admin.id]);
  const base = http.url + "/v1/platform/prospecting"; const headers = { Authorization: `Bearer ${http.operators.admin.token}`, "Content-Type": "application/json" };
  const routes = [["/prospects", "GET"], ["/prospects", "POST"], ["/prospects/missing", "GET"], ["/prospects/missing", "PATCH"], ["/prospects/missing/contact-binding", "POST"], ["/commands/missing", "GET"]] as const;
  const request = (path: string, method = "GET", body?: unknown, customHeaders = headers) => fetch(base + path, { method, headers: customHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    for (const [path, method] of routes) for (const [token, expected] of [["", 401], ["merchant-token", 401], [http.operators.billing.token, 403]] as const) assert.equal((await request(path, method, method === "GET" ? undefined : {}, { ...headers, Authorization: token ? `Bearer ${token}` : "" })).status, expected);
    assert.equal(reads, 0); assert.equal(await f.prisma.platformProspect.count(), 0);
    const command = { snapshotId: "search-old", cnpjs: ["00000000000191"], clientRequestId: "http-add" };
    const added = await request("/prospects", "POST", command); assert.equal(added.status, 201); const id = (await added.json()).prospectIds[0];
    const detail = await (await request("/prospects/" + id)).json(); assert.equal(detail.company.competence, "2026-10"); assert.equal(detail.prospect.stage, "new"); assert.equal(detail.company.contacts[0].validationState, "unknown");
    const bad = await request("/prospects/" + id, "PATCH", { expectedVersion: 1, stage: "converted", assignedOperatorId: "other", tags: ["wrong"], clientRequestId: "invalid-transition" });
    assert.equal(bad.status, 409); assert.equal((await bad.json()).message, "stage_conflict");
    assert.deepEqual((await service.find(id)).prospect, detail.prospect); assert.equal(await f.prisma.prospectCommand.count(), 1);
    const update = { expectedVersion: 1, assignedOperatorId: "other", tags: ["reviewed"], stage: "qualified", clientRequestId: "http-update" };
    assert.equal((await request("/prospects/" + id, "PATCH", update)).status, 200);
    assert.equal((await request("/prospects/" + id, "PATCH", update)).status, 200);
    assert.equal((await request("/prospects/" + id, "PATCH", { ...update, tags: ["divergent"] })).status, 409);
    assert.equal((await request("/prospects/" + id, "PATCH", { ...update, clientRequestId: "stale" })).status, 409);
    await f.prisma.prospectEndpoint.create({ data: { id: "manual", channel: "whatsapp", normalizedValue: "+5511999999999", protectedLookup: "manual-hmac", senderBindingId: "sender" } });
    assert.equal((await request("/prospects/" + id + "/contact-binding", "POST", { endpointId: "manual", evidenceRef: "proof", expectedVersion: 2, clientRequestId: "http-bind" })).status, 201);
    const updated = (await service.find(id)).prospect; assert.equal(updated.version, 3); assert.equal(updated.contacts[0].permission, "no_opt_in");
    assert.equal((await (await request("/commands/http-update")).json()).state, "completed"); assert.equal((await request("/commands/missing")).status, 404);
    const page = await (await request("/prospects?stage=" + encodeURIComponent('["qualified"]') + "&limit=1")).json(); assert.equal(page.items.length, 1); assert.equal(page.items[0].id, id);
    for (const path of ["/prospects?limit=101", "/prospects?stage=broken", "/prospects?search=" + "a".repeat(201), "/prospects?unknown=1", "/prospects?from=bad"]) assert.equal((await request(path)).status, 400);
    for (const body of [{}, { ...command, clientRequestId: "" }, { ...command, optIn: true }]) assert.equal((await request("/prospects", "POST", body)).status, 400);
    assert.equal((await request("/prospects/missing")).status, 404); assert.equal((await request("/prospects/missing", "PATCH", { ...update, clientRequestId: "missing-update" })).status, 404);
    assert.equal((await request("/prospects/" + id + "/contact-binding", "POST", { endpointId: "missing", evidenceRef: "proof", expectedVersion: 3, clientRequestId: "missing-bind" })).status, 404);
    const headerReplay = await request("/prospects", "POST", { snapshotId: command.snapshotId, cnpjs: command.cnpjs }, { ...headers, "Idempotency-Key": command.clientRequestId }); assert.equal(headerReplay.status, 201);
    unavailable = true; assert.equal((await request("/prospects")).status, 503); unavailable = false;
    await http.operatorJwt.revoke(http.operators.admin.token); for (const [path, method] of routes) assert.equal((await request(path, method, method === "GET" ? undefined : {})).status, 401);
    assert.deepEqual(http.ports.meta.calls, []); assert.deepEqual(http.ports.llm.calls, []);
  } finally { await http.close(); await f.close(); }
});
