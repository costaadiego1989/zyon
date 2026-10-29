/**
 * Balance queries for native gas tokens and whitelisted ERC-20 tokens.
 *
 * `getNativeBalance` returns the gas-token balance in *wei* (raw integer).
 * `getErc20Balance` returns the ERC-20 balance in *raw* integer units
 * (e.g. USDC with 6 decimals -> micro-USDC). The caller is responsible for
 * formatting to human units via the token's `decimals` field.
 */
import {
  getAddress,
  isAddress,
  type Address,
  type PublicClient,
} from "viem";
import { getChain, getErc20Token, isSupportedChainId, type Erc20Token } from "./chains.js";

const BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function assertAccount(account: string): Address {
  if (!isAddress(account)) {
    throw new Error(`invalid_account:${account}`);
  }
  return getAddress(account) as Address;
}

export async function getNativeBalance(
  client: PublicClient,
  chainId: number,
  account: string,
): Promise<bigint> {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`unsupported_chain_id:${chainId}`);
  }
  const addr = assertAccount(account);
  return client.getBalance({ address: addr });
}

export async function getErc20Balance(
  client: PublicClient,
  chainId: number,
  symbol: Erc20Token["symbol"],
  account: string,
): Promise<bigint> {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`unsupported_chain_id:${chainId}`);
  }
  const token = getErc20Token(chainId, symbol);
  const addr = assertAccount(account);
  return client.readContract({
    address: token.address,
    abi: BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

export function formatBalance(amountWei: bigint, decimals: number, displayDecimals = 4): string {
  if (decimals < 0) throw new Error("invalid_decimals");
  const base = 10n ** BigInt(decimals);
  const whole = amountWei / base;
  const fraction = amountWei % base;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionStr.slice(0, displayDecimals).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
}

export function chainDisplayName(chainId: number): string {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`unsupported_chain_id:${chainId}`);
  }
  const chain = getChain(chainId);
  return chain.name;
}