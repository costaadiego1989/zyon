import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectingFixture } from "../../../../tests/prospecting-fixture.js";
import { createProspectCrmFixture } from "../../../../tests/prospect-crm-fixture.js";
import { PrismaSegmentRepository } from "../infrastructure/crm/prisma-segment.repository.js";
import { PROSPECTING_PORTS } from "../domain/prospecting.ports.js";
import { ProspectSegmentController } from "./prospect-segment.controller.js";

test("PROS-07 AC2 guards segment CRUD and returns409 for stale versions without overwriting saved filters or server count", async () => {
  const f = await createProspectCrmFixture(); const repo = new PrismaSegmentRepository(f.prisma);
  const http = await createProspectingFixture({ controllers: [ProspectSegmentController], providers: [{ provide: PROSPECTING_PORTS.segments, useValue: repo }, { provide: PROSPECTING_PORTS.directory, useValue: f.directory }] });
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)", [http.operators.admin.id]);
  const base = http.url + "/v1/platform/prospecting/segments"; const headers = { Authorization: `Bearer ${http.operators.admin.token}`, "Content-Type": "application/json" };
  const request = (path: string, method = "GET", body?: unknown, token = http.operators.admin.token) => fetch(base + path, { method, headers: { ...headers, Authorization: token ? `Bearer ${token}` : "" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const routes = [["", "GET"], ["", "POST"], ["/missing", "GET"], ["/missing", "PATCH"], ["/missing", "DELETE"]] as const;
  try {
    for (const [path, method] of routes) for (const [token, code] of [["", 401], ["merchant", 401], [http.operators.support.token, 403]] as const) assert.equal((await request(path, method, method === "GET" ? undefined : {}, token)).status, code);
    assert.equal(await f.prisma.savedProspectSegment.count(), 0);
    const command = { name: "SP", filters: { ufs: ["SP"] }, filterVersion: 1, clientRequestId: "http-segment" };
    const created = await request("", "POST", command); assert.equal(created.status, 201); const first = await created.json();
    assert.equal(first.version, 1); assert.equal(first.ownerOperatorId, http.operators.admin.id); assert.equal(first.count, 2); assert.equal(first.countState, "complete"); assert.equal(first.snapshotId, "search-old");
    assert.equal((await (await request("/" + first.id)).json()).count, 2); assert.equal((await (await request("")).json()).items[0].id, first.id);
    const update = { ...command, name: "RJ", filters: { ufs: ["RJ"] }, expectedVersion: 1, clientRequestId: "http-edit" };
    const edited = await request("/" + first.id, "PATCH", update); assert.equal(edited.status, 200); const second = await edited.json(); assert.equal(second.version, 2); assert.equal(second.count, 1);
    assert.deepEqual(await (await request("/" + first.id, "PATCH", update)).json(), second);
    const stale = await request("/" + first.id, "PATCH", { ...command, expectedVersion: 1, clientRequestId: "http-stale" }); assert.equal(stale.status, 409);
    assert.deepEqual((await repo.find(first.id))?.filters, { ufs: ["RJ"] }); assert.equal((await repo.find(first.id))?.version, 2);
    for (const body of [{}, { ...command, filters: { ufs: ["XX"] } }, { ...command, filterVersion: 2 }, { ...command, name: "" }, { ...command, unexpected: true }]) assert.equal((await request("", "POST", { ...body, clientRequestId: "bad-input" })).status, 400);
    assert.equal((await request("?cursor=x&unknown=1")).status, 400); assert.equal((await request("/missing")).status, 404);
    assert.equal((await request("/missing", "PATCH", { ...update, clientRequestId: "missing-update" })).status, 404);
    assert.equal((await request("/" + first.id, "DELETE", { expectedVersion: 1, clientRequestId: "stale-delete" })).status, 409);
    assert.equal((await request("/" + first.id, "DELETE", { expectedVersion: 2, clientRequestId: "delete" })).status, 204);
    assert.equal((await request("/" + first.id, "DELETE", { expectedVersion: 2, clientRequestId: "delete" })).status, 204);
    assert.equal((await request("/" + first.id)).status, 404); assert.equal((await (await request("")).json()).items.length, 0);
    assert.equal(await f.prisma.prospectCommand.count(), 3); assert.equal(await f.prisma.prospectAuditEvent.count(), 3);
    await http.operatorJwt.revoke(http.operators.admin.token); for (const [path, method] of routes) assert.equal((await request(path, method, method === "GET" ? undefined : {})).status, 401);
  } finally { await http.close(); await f.close(); }
});
