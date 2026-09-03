import test from "node:test";
import assert from "node:assert/strict";
import { PostSaleAiCopywriterService } from "./post-sale-ai-copywriter.service.js";

function svc() {
  return new PostSaleAiCopywriterService();
}

test("buildMetaTemplate: loyalty → positional vars + coupon var + UTILITY", () => {
  const r = svc().buildMetaTemplate({ type: "loyalty", storeName: "Loja X" });
  // Positional placeholders only (Meta requirement).
  assert.match(r.metaBody, /\{\{1\}\}/);
  assert.doesNotMatch(r.metaBody, /\{\{buyerName\}\}/, "no named placeholders remain");
  // Map + samples cover every position used.
  const positions = [...r.metaBody.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
  for (const p of positions) {
    assert.ok(r.variableMap[p], `variableMap has position ${p}`);
    assert.ok(r.sampleVariables[p], `sampleVariables has position ${p}`);
  }
  // Loyalty carries a coupon slot.
  assert.ok(Object.values(r.variableMap).includes("couponBlock"));
  assert.equal(r.category, "UTILITY");
  assert.equal(r.language, "pt_BR");
});

test("buildMetaTemplate: cross_sell → MARKETING category", () => {
  const r = svc().buildMetaTemplate({ type: "cross_sell", storeName: "Loja X" });
  assert.equal(r.category, "MARKETING");
});

test("buildMetaTemplate: follow_up → no coupon slot, storeName inlined", () => {
  const r = svc().buildMetaTemplate({ type: "follow_up", storeName: "Loja X" });
  assert.ok(!Object.values(r.variableMap).includes("couponBlock"), "no coupon slot for follow_up");
  assert.doesNotMatch(r.metaBody, /\{\{storeName\}\}/, "storeName resolved, not a variable");
  assert.match(r.metaBody, /Loja X/);
});

test("metaCategoryFor: only cross_sell is MARKETING", () => {
  const s = svc();
  assert.equal(s.metaCategoryFor("cross_sell"), "MARKETING");
  for (const t of ["follow_up", "review_request", "nps", "win_back", "loyalty", "reorder"] as const) {
    assert.equal(s.metaCategoryFor(t), "UTILITY");
  }
});
