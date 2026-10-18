import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSupportFixture } from "../../../tests/platform-support-fixture.js";

test("merchant AI transparency uses real SQL, sessions and tenant permissions", { skip: !process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL, timeout: 90000 }, async t => {
  const f = await createSupportFixture({ aiMetering: true });
  const a = f.merchants.growth!, b = f.merchants.scale!;
  const route = "/v1/dashboard/finance/ai-usage";
  const period = "?from=2026-10-17&to=2026-10-17";
  async function get(query = period, token: string | undefined = a.token, suffix = "") {
    return fetch(f.first.url + route + suffix + query, { headers: token ? { Authorization: "Bearer " + token } : {} });
  }
  const voice = f.tag + "_voice", unknownVoice = f.tag + "_unknown", rejectedVoice = f.tag + "_rejected", unmeasuredVoice = f.tag + "_unmeasured";
  const at = new Date("2026-10-17T03:00:00Z");
  const event = (merchantId: string, extra: Record<string, unknown> = {}) => f.prisma.aiUsageEvent.create({ data: {
    idempotencyKey: randomUUID(), merchantId, source: "transparency-test", channel: "text", component: "llm",
    provider: "openai", model: "fixture", executionStatus: "succeeded", promptTokens: 100, completionTokens: 10, totalTokens: 110,
    usageKnown: true, measurementOrigin: "server_http", startedAt: at, completedAt: at, latencyMs: 0,
    costMicros: 123456n, currency: "USD", ...extra,
  } });
  try {
    await f.prisma.aiVoiceUsageSession.createMany({ data: [
      { id: voice, merchantId: a.id, billingAccountId: a.id, credentialScope: "private-fixture", model: "fixture", source: "voice_checkout", state: "closed", conversationId: "private", startedAt: at },
      { id: unknownVoice, merchantId: a.id, billingAccountId: a.id, credentialScope: "private-fixture", model: "fixture", source: "voice_narration", state: "unobservable", conversationId: "private", startedAt: at },
      { id: rejectedVoice, merchantId: a.id, billingAccountId: a.id, credentialScope: "private-fixture", model: "fixture", source: "voice_checkout", state: "rejected", conversationId: "private", startedAt: at },
      { id: unmeasuredVoice, merchantId: a.id, billingAccountId: a.id, credentialScope: "private-fixture", model: "fixture", source: "voice_checkout", state: "closed", conversationId: "private", startedAt: at },
    ] });
    await event(a.id);
    await event(a.id, { channel: "voice", costCenter: "voice", component: "realtime_response", measurementOrigin: "server_sideband", voiceSessionId: voice,
      promptTokens: 130, completionTokens: 60, totalTokens: 190, inputDetails: { text_tokens: 100, audio_tokens: 30 }, outputDetails: { text_tokens: 40, audio_tokens: 20 } });
    await event(a.id, { usageKnown: false, executionStatus: "unknown", promptTokens: null, completionTokens: null, totalTokens: null });
    await event(a.id, { usageKnown: false, executionStatus: "rejected", promptTokens: null, completionTokens: null, totalTokens: null });
    await event(a.id, { promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: null });
    await event(a.id, { measurementOrigin: "legacy", component: "voice_admission" });
    await event(a.id, { measurementOrigin: "browser" });
    await event(a.id, { startedAt: new Date(at.getTime() - 1) });
    await event(a.id, { startedAt: new Date("2026-10-18T03:00:00Z") });
    await event(b.id, { promptTokens: 1000000, totalTokens: 1000010 });

    await t.test("provider totals exclude admissions, browser events and other stores; voice sessions are deduplicated", async () => {
      const response = await get(); assert.equal(response.status, 200); const body = await response.json();
      assert.deepEqual(body.summary, { requests: "5", measured_requests: "3", pending_requests: "1", rejected_requests: "1", input_tokens: "230", output_tokens: "70", text_input_tokens: "200", text_output_tokens: "50", audio_input_tokens: "30", audio_output_tokens: "20", voice_sessions: "3" });
      assert.equal(body.daily.length, 1); assert.equal(body.daily[0].date, "2026-10-17");
      assert.equal(body.coverage.incomplete_voice_sessions, "2"); assert.equal(body.coverage.voice_quota_comparable, false);
      assert.equal(body.coverage.first_recorded_at, "2026-10-17T02:59:59.999Z");
      assert.doesNotMatch(JSON.stringify(body), /cost|currency|credential|conversation|private|billingAccount|providerEvent|merchantId/);
    });
    await t.test("client tenant and account parameters cannot change the authenticated store", async () => {
      assert.equal((await get(period + "&merchantId=" + b.id + "&accountId=" + b.id)).status, 403);
      const body = await (await get()).json();
      assert.equal(body.summary.input_tokens, "230");
      const other = await (await get(period, b.token)).json(); assert.equal(other.summary.input_tokens, "1000000");
      const child = await (await get(period, f.merchants.child!.token)).json(); assert.equal(child.summary.requests, "0");
      assert.equal(child.coverage.first_recorded_at, null);
    });
    await t.test("CSV is bounded, uses the same period and excludes internal costs", async () => {
      assert.equal((await get(period + "&merchantId=" + b.id, a.token, "/export.csv")).status, 403);
      const response = await get(period, a.token, "/export.csv");
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type")!, /text\/csv/);
      const csv = await response.text(); assert.match(csv, /"2026-10-17";"5";"3";"1";"1";"230";"70"/);
      assert.doesNotMatch(csv, /123456|1000000|USD|private/);
    });
    await t.test("invalid dates and unbounded periods are rejected before database access", async () => {
      for (const query of ["?from=2026-02-30&to=2026-03-01", "?from=2026-10-18&to=2026-10-17", "?from=2024-01-01&to=2026-10-17", "?from[x]=bad&to=2026-10-17"]) {
        assert.equal((await get(query)).status, 400, query);
      }
    });
    await t.test("anonymous users, platform credentials and store staff cannot read or export", async () => {
      assert.equal((await fetch(f.first.url + route + period)).status, 401);
      assert.equal((await get(period, f.operators.admin!.token)).status, 401);
      await f.prisma.merchantTeamMember.updateMany({ where: { userId: a.userId, merchantId: a.id }, data: { role: "STAFF" } });
      const staff = await f.merchantJwt.issue({ userId: a.userId, merchantId: a.id, email: (await f.prisma.merchantUser.findUniqueOrThrow({ where: { id: a.userId } })).email, role: "staff" });
      assert.equal((await get(period, staff)).status, 403);
      assert.equal((await get(period, staff, "/export.csv")).status, 403);
    });
  } finally { await f.close(); }
});
