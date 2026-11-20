import assert from "node:assert/strict";
import { test } from "node:test";
import { createProspectingFixture, readProspectingTestConfig } from "./prospecting-fixture.js";

test("PROS-02 AC3 fixture rejects every remote dependency before opening any connection", async () => {
  const config = readProspectingTestConfig();
  for (const override of [
    { databaseUrl: "postgresql://user:pass@database.example/zyon_prospecting" },
    { neo4jUri: "bolt://graph.example:7687" }, { redisUrl: "redis://cache.example:6379" },
    { databaseUrl: "postgresql://user:pass@127.0.0.1/real_shop" },
  ]) await assert.rejects(() => createProspectingFixture({ config: { ...config, ...override } }), { message: /^prospecting_fixture_requires_isolated_loopback:/ });
});

test("PROS-02 AC3 fixture proves real local persistence, Nest JWT guards and captured external ports", async () => {
  const fixture = await createProspectingFixture();
  try {
    assert.equal((await fixture.pg.query("SELECT current_database() AS name")).rows[0].name, "zyon_prospecting");
    await fixture.pg.query("CREATE TABLE fixture_business_state (id text PRIMARY KEY, value text NOT NULL)");
    await fixture.pg.query("INSERT INTO fixture_business_state VALUES ($1,$2)", ["proof", "persisted"]);
    const connection = await fixture.pg.connect();
    try { assert.deepEqual((await connection.query("SELECT * FROM fixture_business_state")).rows, [{ id: "proof", value: "persisted" }]); } finally { connection.release(); }
    const session = fixture.neo4j.session();
    try {
      await session.run("CREATE (n:ProspectingFixture {fixtureTag: $tag, value: $value})", { tag: fixture.tag, value: "graph-persisted" });
      const result = await session.run("MATCH (n:ProspectingFixture {fixtureTag: $tag}) RETURN n.value AS value", { tag: fixture.tag });
      assert.equal(result.records[0].get("value"), "graph-persisted");
    } finally { await session.close(); }
    assert.equal(await fixture.redis.ping(), "PONG");
    const noToken = await fetch(fixture.url + "/v1/prospecting-fixture/state");
    assert.equal(noToken.status, 401);
    const badToken = await fetch(fixture.url + "/v1/prospecting-fixture/state", { headers: { Authorization: "Bearer merchant-token" } });
    assert.equal(badToken.status, 401);
    const operator = fixture.operators.admin;
    const response = await fetch(fixture.url + "/v1/prospecting-fixture/state", { headers: { Authorization: `Bearer ${operator.token}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { operatorId: operator.id, persisted: "persisted" });
    const denied = await fetch(fixture.url + "/v1/prospecting-fixture/admin", { headers: { Authorization: `Bearer ${fixture.operators.billing.token}` } });
    assert.equal(denied.status, 403);
    await fixture.operatorJwt.revoke(operator.token);
    assert.equal((await fetch(fixture.url + "/v1/prospecting-fixture/state", { headers: { Authorization: `Bearer ${operator.token}` } })).status, 401);
    await fixture.ports.meta.invoke({ endpoint: "synthetic-local-only", content: "capture" });
    await fixture.ports.llm.invoke({ input: "controlled" }); await fixture.ports.payment.invoke({ event: "verified-fixture" });
    assert.deepEqual(fixture.ports.meta.calls, [{ endpoint: "synthetic-local-only", content: "capture" }]);
    assert.deepEqual(fixture.ports.llm.calls, [{ input: "controlled" }]);
    assert.deepEqual(fixture.ports.payment.calls, [{ event: "verified-fixture" }]);
    await assert.rejects(() => fetch("https://example.com/never-send"), { message: "test_external_network_forbidden" });
  } finally { await fixture.close(); }
});

test("PROS-02 AC3 missing PostgreSQL, graph or Redis makes the fixture fail, never skip", async () => {
  const config = readProspectingTestConfig();
  for (const override of [
    { databaseUrl: config.databaseUrl.replace(":15438/", ":1/") },
    { neo4jUri: "bolt://127.0.0.1:1" }, { redisUrl: "redis://127.0.0.1:1" },
  ]) await assert.rejects(() => createProspectingFixture({ config: { ...config, ...override } }), { message: /^prospecting_fixture_dependency_unavailable:/ });
});
