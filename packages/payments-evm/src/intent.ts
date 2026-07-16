/**
 * Payment intent creation.
 *
 * Native: amount is converted to wei via `parseEther`-style parser for the chain's gas token.
 * ERC-20: amount is converted via the token's decimals and encoded as `transfer(address,uint256)` calldata.
 *
 * The function is pure (no network calls) — safe to call inside request handlers
 * or off-chain workers. Wallet-side execution is the responsibility of the buyer.
 */
import {
  getAddress,
  isAddress,
  parseUnits,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { getChain, getErc20Token, isSupportedChainId, type Erc20Token } from "./chains.js";
import type {
  EncodedTransfer,
  Erc20PaymentIntent,
  NativePaymentIntent,
  PaymentIntent,
} from "./types.js";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const REFERENCE_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

function assertValidReference(reference: string): void {
  if (!REFERENCE_REGEX.test(reference)) {
    throw new Error("invalid_reference");
  }
}

function assertValidRecipient(to: string): Address {
  if (!isAddress(to)) {
    throw new Error(`invalid_recipient:${to}`);
  }
  return getAddress(to) as Address;
}

function assertFresh(expiresAt: number, now: number = Math.floor(Date.now() / 1000)): void {
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("intent_expired_or_invalid_expiry");
  }
}

function assertPositiveAmount(amount: string, decimals: number): bigint {
  if (typeof amount !== "string" || amount.length === 0) {
    throw new Error("invalid_amount");
  }
  let wei: bigint;
  try {
    wei = parseUnits(amount, decimals);
  } catch {
    throw new Error("invalid_amount");
  }
  if (wei <= 0n) {
    throw new Error("amount_must_be_positive");
  }
  return wei;
}

export interface CreateNativeIntentInput {
  chainId: number;
  to: string;
  amount: string;
  reference: string;
  /** Defaults to 15 minutes from now. */
  ttlSeconds?: number;
}

export interface CreateErc20IntentInput {
  chainId: number;
  symbol: Erc20Token["symbol"];
  to: string;
  amount: string;
  reference: string;
  ttlSeconds?: number;
}

export function createNativePaymentIntent(input: CreateNativeIntentInput): NativePaymentIntent {
  if (!isSupportedChainId(input.chainId)) {
    throw new Error(`unsupported_chain_id:${input.chainId}`);
  }
  const to = assertValidRecipient(input.to);
  // Native gas tokens (ETH/MATIC/BNB) all use 18 decimals — safe to hard-code.
  assertPositiveAmount(input.amount, 18);
  assertValidReference(input.reference);

  const ttl = input.ttlSeconds ?? 15 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  assertFresh(expiresAt);

  return {
    kind: "native",
    chainId: input.chainId,
    to,
    amount: input.amount,
    reference: input.reference,
    expiresAt,
  };
}

export function createErc20PaymentIntent(input: CreateErc20IntentInput): Erc20PaymentIntent {
  if (!isSupportedChainId(input.chainId)) {
    throw new Error(`unsupported_chain_id:${input.chainId}`);
  }
  const token = getErc20Token(input.chainId, input.symbol);
  const to = assertValidRecipient(input.to);
  assertPositiveAmount(input.amount, token.decimals);
  assertValidReference(input.reference);

  const ttl = input.ttlSeconds ?? 15 * 60;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  assertFresh(expiresAt);

  return {
    kind: "erc20",
    chainId: input.chainId,
    token,
    to,
    amount: input.amount,
    reference: input.reference,
    expiresAt,
  };
}

export function createPaymentIntent(
  input: CreateNativeIntentInput | CreateErc20IntentInput,
): PaymentIntent {
  if ("symbol" in input) {
    return createErc20PaymentIntent(input);
  }
  return createNativePaymentIntent(input);
}

/**
 * Encode the on-chain call the buyer's wallet will execute for this intent.
 * For ERC-20, this produces a `transfer(to, value)` calldata payload.
 * For native, this is a plain value transfer with empty calldata.
 */
export function encodeIntent(intent: PaymentIntent): EncodedTransfer {
  if (intent.kind === "native") {
    const chain = getChain(intent.chainId);
    return {
      to: intent.to,
      value: parseUnits(intent.amount, chain.nativeCurrency.decimals),
      data: undefined,
    };
  }
  const value = parseUnits(intent.amount, intent.token.decimals);
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [intent.to, value],
  });
  return {
    to: intent.token.address,
    value: 0n,
    data: data as Hex,
  };
}