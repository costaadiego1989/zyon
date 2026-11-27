// @ts-expect-error Node test types are supplied by the focused ready-prod runner.
import test from "node:test";
// @ts-expect-error Node assert types are supplied by the focused ready-prod runner.
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MerchantTrustBadges } from "./MerchantTrustBadges.tsx";

test("renders the merchant's configured trust labels as escaped text", () => {
  const html = renderToStaticMarkup(<MerchantTrustBadges badges={["Atendimento local", "<script>bad()</script>"]} />);
  assert.ok(html.includes("Atendimento local")); assert.ok(html.includes("&lt;script&gt;bad()&lt;/script&gt;")); assert.ok(!html.includes("<script>"));
  assert.equal((html.match(/<li/g) ?? []).length, 2);
});
test("renders no trust footer for empty or absent labels", () => {
  assert.equal(renderToStaticMarkup(<MerchantTrustBadges />), "");
  assert.equal(renderToStaticMarkup(<MerchantTrustBadges badges={[]} />), "");
  assert.equal(renderToStaticMarkup(<MerchantTrustBadges badges={[" "]} />), "");
});

test("caps the footer at four nonempty merchant labels", () => {
  const html = renderToStaticMarkup(<MerchantTrustBadges badges={["", " ", "One", "Two", "Three", "Four", "Fifth"]} />);
  assert.equal((html.match(/<li/g) ?? []).length, 4);
  for (const label of ["One", "Two", "Three", "Four"]) assert.ok(html.includes(label));
  assert.ok(!html.includes("Fifth"));
});
