import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchantCryptoPayments } from "./merchant-crypto.validation.js";

test("normalizeMerchantCryptoPayments rejects invalid treasury when enabled", () => {
  assert.throws(
    () =>
      normalizeMerchantCryptoPayments({
        enabled: true,
        chain: "polygon",
        network: "testnet",
        treasuryAddress: "invalid",
        token: "USDC",
        quoteTtlSeconds: 900
      }),
    /crypto_treasury_address_invalid/
  );
});

test("normalizeMerchantCryptoPayments normalizes valid config", () => {
  const result = normalizeMerchantCryptoPayments({
    enabled: true,
    chain: "polygon",
    network: "testnet",
    treasuryAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
    token: "USDC",
    quoteTtlSeconds: 900,
    brlPerUsdc: 5.5
  });
  assert.equal(result?.treasuryAddress, "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0");
  assert.equal(result?.brlPerUsdc, 5.5);
});
