/**
 * Public types for the universal EVM payments package.
 *
 * A "payment intent" describes what the buyer must pay to the merchant.
 * - `native` intents are denominated in the chain's gas token (ETH, MATIC, BNB).
 * - `erc20` intents are denominated in a whitelisted ERC-20 token (USDT/USDC).
 *
 * The merchant signs no transaction server-side; we only build the parameters
 * the buyer's wallet will execute. The reference (memo) is what binds the
 * off-chain order to the on-chain transfer.
 */
import type { Address, Hash, Hex } from "viem";
import type { Erc20Token, SupportedChainId } from "./chains.js";

export type AssetKind = "native" | "erc20";

export interface NativePaymentIntent {
  kind: "native";
  chainId: SupportedChainId;
  to: Address;
  /** Human-readable amount (e.g. "0.01" for 0.01 ETH). Serialized as string to avoid float drift. */
  amount: string;
  /** Stable order reference encoded in the intent for later reconciliation. */
  reference: string;
  /** Unix seconds after which the intent expires. */
  expiresAt: number;
}

export interface Erc20PaymentIntent {
  kind: "erc20";
  chainId: SupportedChainId;
  token: Erc20Token;
  to: Address;
  /** Human-readable amount in token units (e.g. "25.50" USDC). */
  amount: string;
  reference: string;
  expiresAt: number;
}

export type PaymentIntent = NativePaymentIntent | Erc20PaymentIntent;

/** Verifiable transaction data — what we expect on-chain. */
export interface ExpectedTransfer {
  chainId: SupportedChainId;
  to: Address;
  amountWei: bigint;
  /** Set only for ERC-20. */
  token?: Erc20Token;
  reference: string;
}

export type VerificationResult =
  | { ok: true; txHash: Hash; blockNumber: bigint; confirmations: bigint }
  | { ok: false; reason: VerificationFailure };

export type VerificationFailure =
  | "expired"
  | "tx_not_found"
  | "tx_failed"
  | "to_mismatch"
  | "amount_mismatch"
  | "token_mismatch"
  | "reference_mismatch"
  | "confirmations_insufficient";

/** Minimal wallet surface this package needs to build intents. */
export interface EvmSigner {
  getAddress(): Address;
}

/** Encoded calldata returned for ERC-20 transfers. */
export interface EncodedTransfer {
  to: Address;
  value: bigint;
  data?: Hex;
}
