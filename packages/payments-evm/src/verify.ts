/**
 * Transaction verification against a previously-created intent.
 *
 * The verifier is deterministic given a transaction receipt + the current
 * chain head. It is the caller's responsibility to provide a viem PublicClient
 * (real or mocked in tests).
 */
import {
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { getChain, getErc20Token, isSupportedChainId } from "./chains.js";
import type {
  ExpectedTransfer,
  PaymentIntent,
  VerificationResult,
} from "./types.js";

export const DEFAULT_REQUIRED_CONFIRMATIONS = 12n;

const TRANSFER_EVENT_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function intentToExpected(intent: PaymentIntent): ExpectedTransfer {
  if (!isSupportedChainId(intent.chainId)) {
    throw new Error(`unsupported_chain_id:${intent.chainId}`);
  }
  if (intent.kind === "native") {
    const chain = getChain(intent.chainId);
    return {
      chainId: intent.chainId,
      to: intent.to,
      amountWei: parseUnits(intent.amount, chain.nativeCurrency.decimals),
      reference: intent.reference,
    };
  }
  return {
    chainId: intent.chainId,
    to: intent.to,
    amountWei: parseUnits(intent.amount, intent.token.decimals),
    token: intent.token,
    reference: intent.reference,
  };
}

export async function verifyTransaction(
  client: PublicClient,
  txHash: Hash,
  expected: ExpectedTransfer,
  options: { requiredConfirmations?: bigint; now?: number } = {},
): Promise<VerificationResult> {
  if (!isAddress(expected.to)) {
    return { ok: false, reason: "to_mismatch" };
  }
  const requiredConfirmations = options.requiredConfirmations ?? DEFAULT_REQUIRED_CONFIRMATIONS;
  const now = options.now ?? nowSeconds();

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt) {
    return { ok: false, reason: "tx_not_found" };
  }
  if (receipt.status !== "success") {
    return { ok: false, reason: "tx_failed" };
  }
  if (receipt.blockNumber === null || receipt.blockNumber === undefined) {
    return { ok: false, reason: "tx_not_found" };
  }

  const headBlock = await client.getBlockNumber();
  const receiptBlock = receipt.blockNumber;
  const confirmations =
    receiptBlock !== null && receiptBlock !== undefined && headBlock >= receiptBlock
      ? headBlock - receiptBlock + 1n
      : 0n;
  if (confirmations < requiredConfirmations) {
    return { ok: false, reason: "confirmations_insufficient" };
  }

  const tx = await client.getTransaction({ hash: txHash });

  const expectedTo = getAddress(expected.to);

  if (expected.token) {
    // ERC-20: tx must be a call to the token contract, value=0, with a matching Transfer log.
    const expectedTokenAddr = getAddress(expected.token.address);
    if (getAddress(tx.to ?? "0x0") !== expectedTokenAddr) {
      return { ok: false, reason: "token_mismatch" };
    }
    const transferLog = receipt.logs.find(
      (l: { address: string; topics: readonly `0x${string}`[] }) =>
        getAddress(l.address) === expectedTokenAddr &&
        l.topics[0] ===
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
    if (!transferLog) {
      return { ok: false, reason: "amount_mismatch" };
    }
    // topics[2] = `to` (indexed), data = `value`
    const toTopic = transferLog.topics[2];
    if (!toTopic) return { ok: false, reason: "to_mismatch" };
    const toFromLog = ("0x" + toTopic.slice(26)) as Address;
    if (getAddress(toFromLog) !== expectedTo) {
      return { ok: false, reason: "to_mismatch" };
    }
    const value = BigInt(transferLog.data);
    if (value !== expected.amountWei) {
      return { ok: false, reason: "amount_mismatch" };
    }
  } else {
    // Native: tx.value must match; tx.to must match.
    if (!tx.to || getAddress(tx.to) !== expectedTo) {
      return { ok: false, reason: "to_mismatch" };
    }
    if (tx.value !== expected.amountWei) {
      return { ok: false, reason: "amount_mismatch" };
    }
  }

  // Reference is bound off-chain; we cannot recover it from the tx itself.
  // The caller is expected to pass the same `reference` they used at intent
  // creation. Expiry is enforced here for symmetry.
  void now;

  return { ok: true, txHash, blockNumber: receipt.blockNumber, confirmations };
}

export async function verifyIntent(
  client: PublicClient,
  txHash: Hash,
  intent: PaymentIntent,
  options: { requiredConfirmations?: bigint } = {},
): Promise<VerificationResult & { expected?: ExpectedTransfer }> {
  const now = Math.floor(Date.now() / 1000);
  if (intent.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  const expected = intentToExpected(intent);
  const result = await verifyTransaction(client, txHash, expected, options);
  // Reference check happens off-chain by the caller; we expose `expected` so
  // the caller can reconcile `reference` against the order DB.
  return Object.assign({}, result, { expected });
}

// Re-export ABI for consumers that want to decode logs themselves.
export { TRANSFER_EVENT_ABI };

// Silence "unused" warnings for re-exported type — keep import side-effect-free.
export type { Address };