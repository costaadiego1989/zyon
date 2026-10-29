import test from "node:test";
import assert from "node:assert/strict";
import { intentDustNonce, quoteUsdcFromBrlCents } from "./evm-crypto-quote.service.js";

test("quoteUsdcFromBrlCents converts BRL cents to USDC atomic units", () => {
  const quote = quoteUsdcFromBrlCents(550, 5.5);
  assert.equal(quote.amountAtomic, "1000000");
  assert.equal(quote.amountDisplay, "1.000000 USDC");
});

test("quoteUsdcFromBrlCents rejects zero amount", () => {
  assert.throws(() => quoteUsdcFromBrlCents(0, 5.5), /crypto_quote_amount_invalid/);
});

test("quoteUsdcFromBrlCents binds a per-intent dust nonce so equal-value intents differ", () => {
  const a = quoteUsdcFromBrlCents(550, 5.5, "pay_int_aaaaaaaa");
  const b = quoteUsdcFromBrlCents(550, 5.5, "pay_int_bbbbbbbb");
  // Same nominal value, distinct intents → distinct exact atomic amounts.
  assert.notEqual(a.amountAtomic, b.amountAtomic);
  // Dust stays within [0,999] so the buyer-visible nominal is essentially unchanged.
  const base = 1000000;
  assert.ok(Number(a.amountAtomic) - base >= 0 && Number(a.amountAtomic) - base < 1000);
});

test("intentDustNonce is deterministic and bounded", () => {
  assert.equal(intentDustNonce("pay_int_xyz"), intentDustNonce("pay_int_xyz"));
  assert.ok(intentDustNonce("pay_int_xyz") >= 0 && intentDustNonce("pay_int_xyz") < 1000);
});
