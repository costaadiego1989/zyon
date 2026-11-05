import test from "node:test";
import assert from "node:assert/strict";
import { metaProductComparison } from "./meta-product-comparison.js";
import { publicProductSummary } from "../../../storefront/domain/services/public-product-summary.js";

test("published excerpts preserve Unicode and never exceed 200 characters including ellipsis", () => {
  const text = publicProductSummary('<p>Hidratação &amp; proteção. </p>'.repeat(100));
  assert(Array.from(text).length <= 200);assert(text.endsWith("…"));assert.doesNotMatch(text, /<p>|&amp;/);
  assert(Array.from(publicProductSummary("🛍️".repeat(300))).length <= 200);
  assert.equal(publicProductSummary(undefined), "Descrição não informada.");
  assert.equal(publicProductSummary("<script>unsafe</script> Texto publicado"), "Texto publicado");
});

test("comparison has a phone-width table, exact prices, neutral unknowns and published descriptions", () => {
  const [message] = metaProductComparison([
    { name: "Produto A", price: 9990, inStock: true, description: "Descrição A", attributes: { cor: "Azul", conectividade: "Sem fio 2,4 GHz" } },
    { name: "Produto B", price: 7990, inStock: false, rating: 4.5, description: "Descrição B", attributes: { cor: "Preto" } },
  ]);
  assert.match(message!, /R\$ 99,90/);assert.match(message!, /R\$ 79,90/);assert.match(message!, /Descrição A/);
  assert.match(message!, /Sem av\./);assert.match(message!, /Não inf\./);assert.doesNotMatch(message!, /melhor|ideal para pele|100%/);
  const table = message!.split("```\n")[1]!.split("\n```")[0]!;
  assert(table.split("\n").every(line => Array.from(line).length <= 34));
});

test("large prices are never truncated and five products are compared without dropping identities", () => {
  const results = metaProductComparison(Array.from({ length: 5 }, (_, i) => ({ name: `Produto ${i}`, price: 123456789, attributes: {} })));
  assert.equal(results.length, 3);
  for (let i = 0; i < 5; i++)assert(results.some(message => message.includes(`Produto ${i}`)));
  assert.match(results[0]!, /R\$ 1\.234\.567,89/);assert.match(results[0]!, /Legenda/);
});
