import test from "node:test";
import assert from "node:assert/strict";
import { quoteUsdcFromBrlCents } from "./evm-crypto-quote.service.js";

test("quoteUsdcFromBrlCents converts BRL cents to USDC atomic units", () => {
  const quote = quoteUsdcFromBrlCents(550, 5.5);
  assert.equal(quote.amountAtomic, "1000000");
  assert.equal(quote.amountDisplay, "1.00 USDC");
});

test("quoteUsdcFromBrlCents rejects zero amount", () => {
  assert.throws(() => quoteUsdcFromBrlCents(0, 5.5), /crypto_quote_amount_invalid/);
});
