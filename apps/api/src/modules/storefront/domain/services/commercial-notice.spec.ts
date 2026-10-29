import test from "node:test";
import assert from "node:assert/strict";
import { commercialNotice } from "./commercial-notice.js";
import { commercialNoticeSchema } from "../contracts/commercial-notice.schemas.js";
const codes = ["discount_limit_reached", "discount_limited", "discount_unavailable", "benefit_not_combinable", "benefit_conditions_not_met"] as const;
for (const code of codes) test(`deterministic public copy for ${code} includes no private economic values`, () => {
  const first = commercialNotice(code), second = commercialNotice(code);
  assert.deepEqual(first, second); assert.notEqual(first, second); assert.deepEqual(Object.keys(first).sort(), ["code","message","version"]);
  assert.equal(first.code, code); assert.equal(first.version, 1); assert.equal(commercialNoticeSchema.safeParse(first).success, true);
  assert.doesNotMatch(first.message, /\d|%|margem|custo|token|hash|fingerprint/i);
  if (code !== "discount_limit_reached") assert.doesNotMatch(first.message, /j[aá] obteve|m[aá]ximo permitido|limite.*atingido/i);
});
test("maximum notice has exact approved truthful copy; invalid runtime codes fail closed", () => {
  assert.equal(commercialNotice("discount_limit_reached").message, "Você já obteve o desconto máximo permitido por esta loja nos produtos deste pedido. Outros benefícios não aumentam esse desconto.");
  assert.throws(() => commercialNotice("invented" as never));
});

