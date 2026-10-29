import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmbedOrigin } from "./embed-client.js";

test("drops trailing slashes and trims whitespace from origins", () => {
  assert.equal(normalizeEmbedOrigin("https://loja.pt/ "), "https://loja.pt");
});
