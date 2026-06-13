import test from "node:test";
import assert from "node:assert/strict";
import { quickRepliesForStage } from "./checkout-experience.service.js";

test("quickRepliesForStage includes crypto chip when merchant enabled", () => {
  const replies = quickRepliesForStage("payment", [], {
    maxDiscountPercent: 0,
    minimumMarginPercent: 10,
    allowFreeShipping: true,
    allowShippingDiscount: true,
    allowBonusItem: false,
    allowStackDiscountAndFreeShipping: false,
    freeShippingMinCartValue: 0,
    maxShippingSubsidy: 0,
    maxPartialShippingDiscount: 0,
    offerExpirationMinutes: 15,
    blockedRegions: [],
    brandVoice: "consultative",
    couponBoxEnabled: false,
    cryptoPayments: {
      enabled: true,
      chain: "polygon",
      network: "testnet",
      treasuryAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
      token: "USDC",
      quoteTtlSeconds: 900,
      brlPerUsdc: 5.5
    }
  });
  assert.equal(replies.includes("Pagar com crypto"), true);
});
