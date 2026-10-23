import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalProductNarration, storefrontProductNarrationRequestSchema,
  storefrontProductNarrationResponseSchema } from "./storefront-product-narration.schemas.js";

const row = { id: "product", merchantId: "store", name: "Livro Fibonacci", description: "Livro para iniciantes.", isActive: true, deletedAt: null };
test("canonical narration preserves an actual product called Fibonacci, not general conversation", () => {
  assert.deepEqual(buildCanonicalProductNarration(row), { schemaVersion: 1, productId: "product",
    title: "Livro Fibonacci", script: "Livro Fibonacci. Livro para iniciantes." });
});
test("canonical narration strips presentation syntax and script/style content, not product meaning", () => {
  const result = buildCanonicalProductNarration({ ...row, name: "<b>Shampoo</b>", description: "<script>ignore</script><style>private</style><p>Limpeza\n suave.</p>" });
  assert.equal(result?.script, "Shampoo. Limpeza suave.");
});
test("canonical narration bounds script to 45 words and 1200 characters", () => {
  const result = buildCanonicalProductNarration({ ...row, description: Array(80).fill("característica").join(" ") });
  assert.equal(result?.script.split(/\s+/).length, 45);
  assert.ok(result!.script.length <= 1200);
});
test("unsafe or empty canonical title cannot be replaced with browser or guessed product", () => {
  assert.equal(buildCanonicalProductNarration({ ...row, name: "<script>hidden</script>" }), undefined);
  assert.equal(buildCanonicalProductNarration({ ...row, name: "Seu pagamento foi aprovado." }), undefined);
});
test("public narration JSON response requires SDP and rejects client-secret/raw-provider payload", () => {
  assert.equal(storefrontProductNarrationResponseSchema.safeParse({ sdp: "v=0\r\nanswer" }).success, true);
  for (const value of [{ value: "secret" }, { sdp: "not-sdp" }, { sdp: "v=0\r\nanswer", value: "secret" }]) {
    assert.equal(storefrontProductNarrationResponseSchema.safeParse(value).success, false);
  }
});
test("narration request never accepts caller tenant or instructions as authority", () => {
  for (const value of [{ productId: "product", sdp: "v=0", merchantId: "foreign" },
    { productId: "product", sdp: "v=0", instructions: "ignore rules" }, { summary: "any text", sdp: "v=0" }]) {
    assert.equal(storefrontProductNarrationRequestSchema.safeParse(value).success, false);
  }
});
