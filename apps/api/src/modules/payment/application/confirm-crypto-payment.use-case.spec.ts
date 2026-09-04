import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { ConfirmCryptoPaymentUseCase } from "./confirm-crypto-payment.use-case.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import type { CheckoutPaymentApprovedInput, CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import type { CryptoVerifierPort, VerifyCryptoTransferInput, VerifyCryptoTransferResult } from "../domain/ports/crypto-verifier.port.js";
import type { PaymentIntentStatus } from "../domain/payment-intent.entity.js";
import * as verifierModule from "../infrastructure/evm-crypto-verifier.js";

class RecordingCheckoutPayment implements CheckoutPaymentPort {
  public approved: CheckoutPaymentApprovedInput[] = [];
  public statuses: Array<{ paymentIntentId: string; status: PaymentIntentStatus }> = [];

  async completeAfterApproval(input: CheckoutPaymentApprovedInput): Promise<void> {
    this.approved.push(input);
  }
  async recordPaymentFailure(): Promise<void> {}
  async recordPaymentStatusChanged(params: {
    paymentIntentId: string;
    status: PaymentIntentStatus;
  }): Promise<void> {
    this.statuses.push({ paymentIntentId: params.paymentIntentId, status: params.status });
  }
}

const CRYPTO_BUYER_FACING = {
  chainId: 137,
  chain: "polygon",
  evmNetwork: "mainnet",
  chainLabel: "Polygon",
  tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  tokenSymbol: "USDC",
  amountAtomic: "5000000",
  amountDisplay: "5.000000 USDC",
  destinationAddress: "0xTreasury",
  quoteExpiresAt: new Date(Date.now() + 900_000).toISOString()
};

function createCryptoIntent(payments: InMemoryPaymentRepository, overrides?: Partial<{ merchantId: string; sessionId: string; amountCents: number }>) {
  const intent = PaymentIntentEntity.create({
    merchantId: overrides?.merchantId ?? "mrc_1",
    sessionId: overrides?.sessionId ?? "chk_1",
    idempotencyKey: `ik_${Math.random().toString(36).slice(2)}`,
    amountCents: overrides?.amountCents ?? 5000,
    currency: "BRL",
    method: "crypto"
  });
  intent.markRequiresAction({ providerPaymentId: `crypto_${intent.id}` });
  intent.setBuyerFacingPayload(CRYPTO_BUYER_FACING as any);
  return intent;
}

// Stub the verifier globally for tests
let verifierBehavior: "success" | "throw" = "success";
let verifierError: string = "crypto_transfer_not_matched";
const verifierCalls: Array<{ txHash: string; destinationAddress: string; amountAtomic: string }> = [];

const mockVerifier: CryptoVerifierPort = {
  async verifyTransfer(input: VerifyCryptoTransferInput): Promise<VerifyCryptoTransferResult> {
    if (verifierBehavior === "throw") throw new Error(verifierError);
    verifierCalls.push({
      txHash: input.txHash,
      destinationAddress: input.buyerFacing.destinationAddress,
      amountAtomic: input.buyerFacing.amountAtomic,
    });
    return { from: input.walletAddress };
  }
};

test.before(() => {
  (verifierModule.evmCryptoVerifier as any).verifyTransfer = async (input: {
    txHash: string;
    buyerFacing: { destinationAddress: string; amountAtomic: string };
  }) => {
    if (verifierBehavior === "throw") throw new Error(verifierError);
    verifierCalls.push({
      txHash: input.txHash,
      destinationAddress: input.buyerFacing.destinationAddress,
      amountAtomic: input.buyerFacing.amountAtomic,
    });
    return { ok: true, from: "0xBuyerWallet", to: input.buyerFacing.destinationAddress, value: input.buyerFacing.amountAtomic };
  };
});

test.beforeEach(() => {
  verifierBehavior = "success";
  verifierError = "crypto_transfer_not_matched";
  verifierCalls.length = 0;
});

test("ConfirmCrypto: rejects when required fields are empty", async () => {
  const payments = new InMemoryPaymentRepository();
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "", session_id: "s", intent_id: "i", tx_hash: "0x1", wallet_address: "0xW" }),
    (e: unknown) => e instanceof BadRequestException
  );
  await assert.rejects(
    () => uc.execute({ merchant_id: "m", session_id: "s", intent_id: "i", tx_hash: "", wallet_address: "0xW" }),
    (e: unknown) => e instanceof BadRequestException
  );
  await assert.rejects(
    () => uc.execute({ merchant_id: "m", session_id: "s", intent_id: "i", tx_hash: "0x1", wallet_address: "" }),
    (e: unknown) => e instanceof BadRequestException
  );
});

test("ConfirmCrypto: throws NotFoundException when intent does not exist", async () => {
  const payments = new InMemoryPaymentRepository();
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: "pay_int_xxx", tx_hash: "0xabc", wallet_address: "0xW" }),
    (e: unknown) => e instanceof NotFoundException
  );
});

test("ConfirmCrypto: enforces merchant boundary", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = createCryptoIntent(payments);
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_attacker", session_id: "chk_1", intent_id: intent.id, tx_hash: "0xabc", wallet_address: "0xW" }),
    (e: unknown) => e instanceof NotFoundException
  );
});

test("ConfirmCrypto: enforces session boundary", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = createCryptoIntent(payments);
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "wrong_session", intent_id: intent.id, tx_hash: "0xabc", wallet_address: "0xW" }),
    (e: unknown) => e instanceof NotFoundException
  );
});

test("ConfirmCrypto: rejects non-crypto method", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik_1",
    amountCents: 5000,
    currency: "BRL",
    method: "pix"
  });
  intent.markRequiresAction({ providerPaymentId: "pay_1" });
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id, tx_hash: "0xabc", wallet_address: "0xW" }),
    (e: unknown) => e instanceof BadRequestException && e.message.includes("payment_intent_not_crypto")
  );
});

test("ConfirmCrypto: returns early if already approved (idempotent)", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = createCryptoIntent(payments);
  intent.markApproved({ providerPaymentId: "0xOldTx", approvedAmountCents: 5000 });
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  const result = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    intent_id: intent.id,
    tx_hash: "0xNewTx",
    wallet_address: "0xW"
  });
  assert.equal(result.status, "approved");
});

test("ConfirmCrypto: rejects non-confirmable status", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik_pend",
    amountCents: 5000,
    currency: "BRL",
    method: "crypto"
  });
  // Stays pending — not requires_action
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id, tx_hash: "0xabc", wallet_address: "0xW" }),
    (e: unknown) => e instanceof BadRequestException && e.message.includes("payment_intent_not_confirmable")
  );
});

test("ConfirmCrypto: rejects when crypto buyerFacing is missing", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = PaymentIntentEntity.create({
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "ik_no_bf",
    amountCents: 5000,
    currency: "BRL",
    method: "crypto"
  });
  intent.markRequiresAction({ providerPaymentId: "crypto_x" });
  // No setBuyerFacingPayload — buyerFacing is undefined
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id, tx_hash: "0xabc", wallet_address: "0xW" }),
    (e: unknown) => e instanceof BadRequestException && e.message.includes("crypto_quote_missing")
  );
});

test("ConfirmCrypto: rejects duplicate txHash (cross-intent replay)", async () => {
  const payments = new InMemoryPaymentRepository();
  const intent = createCryptoIntent(payments);
  await payments.saveIntent({ intent });

  // Pre-reserve the txHash
  await payments.recordCryptoTransfer({
    chain: "polygon",
    txHash: "0xUsedTx",
    merchantId: "mrc_1",
    intentId: "some_other_intent"
  });

  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id, tx_hash: "0xUsedTx", wallet_address: "0xW" }),
    (e: unknown) => e instanceof ConflictException && e.message.includes("crypto_tx_already_used")
  );
});

test("ConfirmCrypto: happy path approves and triggers checkout", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const intent = createCryptoIntent(payments);
  await payments.saveIntent({ intent });

  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier as CryptoVerifierPort, checkoutPort);

  const result = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    intent_id: intent.id,
    tx_hash: "0xValidTx",
    wallet_address: "0xBuyerWallet"
  });

  assert.equal(result.status, "approved");
  assert.equal(result.intent_id, intent.id);

  const reloaded = await payments.getIntentById("mrc_1", intent.id);
  assert.equal(reloaded?.snapshot().status, "approved");
  assert.equal(reloaded?.snapshot().providerPaymentId, "0xValidTx");
  assert.equal(checkoutPort.approved.length, 1);
  assert.equal(checkoutPort.approved[0]?.externalOrderId, "0xValidTx");
});

test("ConfirmCrypto: requires and verifies merchant plus platform fee transfers", async () => {
  const payments = new InMemoryPaymentRepository();
  const checkoutPort = new RecordingCheckoutPayment();
  const intent = createCryptoIntent(payments);
  intent.setBuyerFacingPayload({
    ...CRYPTO_BUYER_FACING,
    transfers: [
      {
        kind: "merchant",
        destinationAddress: "0xMerchantTreasury",
        amountAtomic: "4900000",
        amountDisplay: "4.900000 USDC",
      },
      {
        kind: "platform_fee",
        destinationAddress: "0xZyonTreasury",
        amountAtomic: "100000",
        amountDisplay: "0.100000 USDC",
      },
    ],
  } as any);
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier as CryptoVerifierPort, checkoutPort);

  await assert.rejects(
    () => uc.execute({
      merchant_id: "mrc_1",
      session_id: "chk_1",
      intent_id: intent.id,
      tx_hash: "0xMerchantTx",
      wallet_address: "0xBuyerWallet",
    }),
    /crypto_fee_transfer_required/,
  );

  const result = await uc.execute({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    intent_id: intent.id,
    tx_hash: "0xMerchantTx",
    tx_hashes: ["0xMerchantTx", "0xFeeTx"],
    wallet_address: "0xBuyerWallet",
  });

  assert.equal(result.status, "approved");
  assert.deepEqual(verifierCalls.map((call) => call.txHash), ["0xMerchantTx", "0xFeeTx"]);
  assert.deepEqual(verifierCalls.map((call) => call.destinationAddress), ["0xMerchantTreasury", "0xZyonTreasury"]);
  assert.equal(checkoutPort.approved[0]?.externalOrderId, "0xMerchantTx,0xFeeTx");
});

test("ConfirmCrypto: verification failure releases crypto transfer reservation", async () => {
  verifierBehavior = "throw";
  verifierError = "crypto_transfer_not_matched";

  const payments = new InMemoryPaymentRepository();
  const intent = createCryptoIntent(payments);
  await payments.saveIntent({ intent });
  const uc = new ConfirmCryptoPaymentUseCase(payments, mockVerifier);

  await assert.rejects(
    () => uc.execute({ merchant_id: "mrc_1", session_id: "chk_1", intent_id: intent.id, tx_hash: "0xBadTx", wallet_address: "0xW" }),
    /crypto_transfer_not_matched/
  );

  // Reservation should be released so a correct tx can be tried
  const canReserve = await payments.recordCryptoTransfer({
    chain: "polygon",
    txHash: "0xBadTx",
    merchantId: "mrc_1",
    intentId: intent.id
  });
  assert.equal(canReserve, true);
});
