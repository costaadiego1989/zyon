import { createPublicClient, decodeEventLog, http, type Hash, type Hex } from "viem";
import { base, baseSepolia, polygon, polygonAmoy } from "viem/chains";
import {
  ERC20_TRANSFER_TOPIC,
  evmChainId,
  isQuoteExpired,
  minConfirmations,
  resolveRpcUrl,
  type CryptoBuyerFacing,
  type EvmChain,
  type EvmNetwork
} from "./evm-crypto.constants.js";
import type { CryptoVerifierPort, VerifyCryptoTransferInput, VerifyCryptoTransferResult } from "../domain/ports/crypto-verifier.port.js";

export class EvmCryptoVerifier implements CryptoVerifierPort {
  async verifyTransfer(input: VerifyCryptoTransferInput): Promise<VerifyCryptoTransferResult> {
    if (isQuoteExpired(input.buyerFacing.quoteExpiresAt)) {
      throw new Error("crypto_quote_expired");
    }

    const chain = input.buyerFacing.chain as EvmChain;
    const network = input.buyerFacing.evmNetwork as EvmNetwork;
    const rpcUrl = resolveRpcUrl(chain, network);
    if (!rpcUrl) {
      throw new Error("crypto_rpc_not_configured");
    }

    const viemChain = resolveViemChain(chain, network);
    const client = createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl)
    });

    const hash = input.txHash.trim() as Hash;
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("crypto_tx_not_successful");
    }

    const currentBlock = await client.getBlockNumber();
    const confirmations = Number(currentBlock - receipt.blockNumber) + 1;
    if (confirmations < minConfirmations(network)) {
      throw new Error("crypto_insufficient_confirmations");
    }

    const token = input.buyerFacing.tokenAddress.toLowerCase();
    const treasury = input.buyerFacing.destinationAddress.toLowerCase();
    const expectedValue = BigInt(input.buyerFacing.amountAtomic);
    const wallet = input.walletAddress.toLowerCase();

    // Require exactly one Transfer matching the per-intent discriminant
    // (treasury + exact dust-bound value + sender). Multiple matches or none
    // is rejected — no ambiguous settlement (ADR 0001 #2/#13).
    const matches: { from: string; to: string; value: string }[] = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== token) continue;
      if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
      try {
        const decoded = decodeEventLog({
          abi: [
            {
              type: "event",
              name: "Transfer",
              inputs: [
                { name: "from", type: "address", indexed: true },
                { name: "to", type: "address", indexed: true },
                { name: "value", type: "uint256", indexed: false }
              ]
            }
          ],
          data: log.data as Hex,
          topics: log.topics as [Hex, Hex, Hex]
        });
        const from = String(decoded.args.from).toLowerCase();
        const to = String(decoded.args.to).toLowerCase();
        const value = decoded.args.value as bigint;
        if (to === treasury && value === expectedValue && from === wallet) {
          matches.push({ from, to, value: value.toString() });
        }
      } catch {
        continue;
      }
    }

    if (matches.length === 0) {
      throw new Error("crypto_transfer_not_matched");
    }
    if (matches.length > 1) {
      throw new Error("crypto_transfer_ambiguous_match");
    }
    return { from: matches[0]!.from };
  }
}

function resolveViemChain(chain: EvmChain, network: EvmNetwork) {
  const id = evmChainId(chain, network);
  if (chain === "polygon") {
    return network === "testnet" ? polygonAmoy : polygon;
  }
  return network === "testnet" ? baseSepolia : base;
}

export const evmCryptoVerifier = new EvmCryptoVerifier();
