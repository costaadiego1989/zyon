import assert from "node:assert/strict";
import test from "node:test";
import { PublicBusinessLiveTools, renderPublicBusinessLiveFacts } from "./public-business-live-tools.js";
import type { LiveBusinessSnapshot, PublicBusinessAnswerSession } from "./public-business-answer-session.js";

const request = { productId: "service", professionalId: "professional", fromDate: "2030-01-02", toDate: "2030-01-02" };
function fixture() {
  const reads: unknown[] = [], pairs: unknown[] = [], attachments: Array<{ choice: any; read: any }> = [];
  let variants = ["variant"], scope = "merchant", failure = false, admitted = true;
  const prisma = { $transaction: async (work: any) => work({ $queryRaw: async () => [{ id: "merchant" }],
    product: { findFirst: async (query: any) => {
      reads.push(query); if (failure) throw Error("synthetic_sql_unavailable");
      return { variants: variants.map(id => ({ id })) };
    } } }) };
  const reader = { async read(choice: unknown, bound: unknown) { return { choice, bound }; } };
  const tool = new PublicBusinessLiveTools(prisma as never, { get: () => ({ merchantId: scope }) } as never,
    reader as never, () => new Date("2030-01-01T00:00:00Z"));
  const session = { async captureCanonical(value: unknown) { pairs.push(value); return { status: admitted ? "ready" : "insufficient" }; },
    attachLive(choice: unknown, read: unknown) { attachments.push({ choice, read }); } } as unknown as PublicBusinessAnswerSession;
  return { tool, session, reads, pairs, attachments, variants: (value: string[]) => { variants = value; },
    foreign: () => { scope = "foreign"; }, fail: () => { failure = true; }, denyPair: () => { admitted = false; } };
}
test("T71 live tool resolves the only current active variant and binds a read with no caller hold owner", async () => {
  const f = fixture(); assert.deepEqual(await f.tool.attach(f.session, { merchantId: "merchant", request }), { status: "attached" });
  assert.equal(f.reads.length, 1); assert.equal((f.reads[0] as any).where.merchantId, "merchant");
  assert.equal((f.reads[0] as any).where.type, "service"); assert.equal((f.reads[0] as any).where.isActive, true);
  assert.deepEqual(f.pairs, [{ merchantId: "merchant", mode: "service_professional", limit: 2,
    pairs: [{ serviceId: "service", professionalId: "professional" }] }]);
  assert.equal(f.attachments.length, 1); assert.equal(f.attachments[0].choice.variantId, "variant");
  assert.deepEqual(await f.attachments[0].read({ ...f.attachments[0].choice, merchantId: "merchant" }), {
    choice: { ...request, variantId: "variant", merchantId: "merchant" }, bound: { merchantId: "merchant" },
  });
});
test("T71 ambiguous variants clarify rather than choosing a default or reserving capacity", async () => {
  const f = fixture(); f.variants(["first", "second"]);
  assert.deepEqual(await f.tool.attach(f.session, { merchantId: "merchant", request }), { status: "clarification", reason: "variant_required" });
  assert.deepEqual(f.pairs, []); assert.deepEqual(f.attachments, []);
});
test("T71 explicit variants must be active members of the selected canonical service", async () => {
  const f = fixture(); f.variants([]);
  assert.deepEqual(await f.tool.attach(f.session, { merchantId: "merchant", request: { ...request, variantId: "foreign-variant" } }),
    { status: "clarification", reason: "service_unavailable" });
  assert.deepEqual(f.attachments, []);
});
test("T71 foreign scope and caller authority fields cannot reach a live read", async () => {
  const f = fixture(); f.foreign();
  await assert.rejects(f.tool.attach(f.session, { merchantId: "merchant", request }), /scope_mismatch/);
  assert.deepEqual(f.reads, []);
  const own = fixture();
  for (const extra of [{ merchantId: "foreign" }, { holdOwnerId: "someone-else" }, { cypher: "MATCH(n) RETURN n" }]) {
    assert.deepEqual(await own.tool.attach(own.session, { merchantId: "merchant", request: { ...request, ...extra } }),
      { status: "clarification", reason: "invalid_request" });
  }
  assert.deepEqual(own.reads, []);
});
test("T71 invalid dates, missing relationship and SQL failure stay unavailable without attachment", async () => {
  const invalid = fixture();
  assert.deepEqual(await invalid.tool.attach(invalid.session, { merchantId: "merchant", request: { ...request, toDate: "2030-02-30" } }),
    { status: "clarification", reason: "invalid_request" });
  assert.deepEqual(invalid.reads, []);
  const unlinked = fixture(); unlinked.denyPair();
  assert.deepEqual(await unlinked.tool.attach(unlinked.session, { merchantId: "merchant", request }),
    { status: "clarification", reason: "pair_not_admitted" }); assert.deepEqual(unlinked.attachments, []);
  const outage = fixture(); outage.fail();
  assert.deepEqual(await outage.tool.attach(outage.session, { merchantId: "merchant", request }),
    { status: "unavailable", reason: "canonical_unavailable" }); assert.deepEqual(outage.attachments, []);
});
const snapshot = (slots = 1): LiveBusinessSnapshot => ({ facts: { priceInCents: 6100, currency: "BRL", timeZone: "UTC" },
  publicLabels: { serviceName: "Consulta publicada", professionalName: "Profissional publicado" },
  availability: { status: slots ? "ready" : "empty", timeZone: "UTC", slots: Array.from({ length: slots }, (_, index) => ({
    startsAt: `2030-01-02T${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00Z`,
    endsAt: `2030-01-02T${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "50" : "20"}:00Z`,
    date: "2030-01-02", startTime: `${String(10 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`,
  })) } } as LiveBusinessSnapshot);
test("T71 synchronous live renderer uses current machine values and published labels", () => {
  const result = renderPublicBusinessLiveFacts([snapshot()], { format: "whatsapp" });
  assert.match(result.message, /\*Consulta publicada\*/); assert.match(result.message, /Profissional publicado/);
  assert.match(result.message, /61,00/); assert.match(result.message, /02\/01\/2030/); assert.match(result.message, /10:00/);
  assert.match(result.message, /UTC/); assert.match(result.message, /podem mudar/);
});
test("T71 live empty and truncated windows do not imply a global lack of appointments or a complete list", () => {
  assert.match(renderPublicBusinessLiveFacts([snapshot(0)]).message, /período consultado/);
  const result = renderPublicBusinessLiveFacts([snapshot(13)]).message;
  assert.match(result, /outros horários/); assert.equal(result.includes("16:00"), false);
});
test("T71 malformed live facts cannot render a price or a fictional slot", () => {
  assert.throws(() => renderPublicBusinessLiveFacts([{ ...snapshot(), facts: { ...snapshot().facts, priceInCents: -1 } }]), /live_facts_invalid/);
  assert.throws(() => renderPublicBusinessLiveFacts([{ ...snapshot(), availability: { ...snapshot().availability, status: "stale" } }]), /live_facts_invalid/);
  const beyondDisplay = snapshot(13); beyondDisplay.availability.slots[12]!.startsAt = "invalid";
  assert.throws(() => renderPublicBusinessLiveFacts([beyondDisplay]), /live_facts_invalid/);
});
