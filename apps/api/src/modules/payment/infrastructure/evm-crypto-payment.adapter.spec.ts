import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";
import { EvmCryptoPaymentAdapter } from "./evm-crypto-payment.adapter.js";
import type { CryptoQuoteService } from "./crypto-quote.service.js";

const MERCHANT_TREASURY = "0x1111111111111111111111111111111111111111";
const ZYON_TREASURY = "0x2222222222222222222222222222222222222222";

// Deterministic quote stub: echoes the merchant's configured fallback so tests
// stay offline and the atomic amounts remain stable.
const stubQuote = {
  getUsdcBrl: async (fallback?: number) => ({
    brlPerUsdc: fallback ?? 5,
    source: "fallback" as const,
    cachedAt: new Date(0).toISOString(),
  }),
} as unknown as CryptoQuoteService;

test("EvmCryptoPaymentAdapter splits merchant amount and Zyon platform fee", async () => {
  const previous = process.env.ZYON_CRYPTO_TREASURY_ADDRESS;
  process.env.ZYON_CRYPTO_TREASURY_ADDRESS = ZYON_TREASURY;
  try {
    const merchants = new InMemoryMerchantRepository();
    merchants.seedRules("mrc_crypto", {
      cryptoPayments: {
        enabled: true,
        chain: "polygon",
        network: "testnet",
        treasuryAddress: MERCHANT_TREASURY,
        token: "USDC",
        brlPerUsdc: 5,
        quoteTtlSeconds: 900,
      },
    });
    const adapter = new EvmCryptoPaymentAdapter(merchants, stubQuote);

    const payment = await adapter.createPayment({
      merchantId: "mrc_crypto",
      sessionId: "chk_crypto",
      intentId: "pi_crypto_split",
      amountCents: 10_000,
      platformFeeCents: 199,
      currency: "BRL",
      method: "crypto",
    });

    const transfers = payment.buyerFacingPayload.transfers;
    assert.equal(payment.status, "requires_action");
    assert.equal(transfers?.length, 2);
    assert.equal(transfers?.[0]?.kind, "merchant");
    assert.equal(transfers?.[0]?.destinationAddress, MERCHANT_TREASURY);
    assert.equal(transfers?.[1]?.kind, "platform_fee");
    assert.equal(transfers?.[1]?.destinationAddress, ZYON_TREASURY);
    assert.notEqual(transfers?.[0]?.amountAtomic, transfers?.[1]?.amountAtomic);
  } finally {
    if (previous === undefined) delete process.env.ZYON_CRYPTO_TREASURY_ADDRESS;
    else process.env.ZYON_CRYPTO_TREASURY_ADDRESS = previous;
  }
});

test("EvmCryptoPaymentAdapter refuses fee-bearing crypto when Zyon treasury is missing", async () => {
  const previous = process.env.ZYON_CRYPTO_TREASURY_ADDRESS;
  delete process.env.ZYON_CRYPTO_TREASURY_ADDRESS;
  try {
    const merchants = new InMemoryMerchantRepository();
    merchants.seedRules("mrc_crypto", {
      cryptoPayments: {
        enabled: true,
        chain: "polygon",
        network: "testnet",
        treasuryAddress: MERCHANT_TREASURY,
        token: "USDC",
        brlPerUsdc: 5,
        quoteTtlSeconds: 900,
      },
    });
    const adapter = new EvmCryptoPaymentAdapter(merchants, stubQuote);

    await assert.rejects(
      () => adapter.createPayment({
        merchantId: "mrc_crypto",
        sessionId: "chk_crypto",
        intentId: "pi_crypto_split",
        amountCents: 10_000,
        platformFeeCents: 199,
        currency: "BRL",
        method: "crypto",
      }),
      /zyon_crypto_treasury_required/,
    );
  } finally {
    if (previous === undefined) delete process.env.ZYON_CRYPTO_TREASURY_ADDRESS;
    else process.env.ZYON_CRYPTO_TREASURY_ADDRESS = previous;
  }
});
