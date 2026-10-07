import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StarRating } from "./StarRating";

test("the rendered card omits stars when the server reports zero reviews", () => {
  const html = renderToStaticMarkup(<StarRating value={4.3} count={0} />);
  assert.match(html, /Ainda sem avaliações/); assert.equal(html.includes("★"), false); assert.equal(html.includes("4.3"), false);
});
test("an unavailable average preserves a known review count, and a valid average renders stars", () => {
  const unavailable = renderToStaticMarkup(<StarRating count={3} />);
  assert.match(unavailable, /3 avaliações/); assert.match(unavailable, /nota indisponível/); assert.equal(unavailable.includes("Ainda sem"), false);
  const real = renderToStaticMarkup(<StarRating value={4.5} count={3} />);
  assert.match(real, /Avaliação 4.5 de 5/); assert.match(real, /3 avaliações/); assert.ok(real.includes("★"));
});
