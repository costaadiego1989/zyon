import { createPublicClient, decodeEventLog, http, type Hash, type Hex } from "viem";
import { base, baseSepolia, polygon, polygonAmoy } from "viem/chains";
import { Logger } from "@nestjs/common";
import {
  ERC20_TRANSFER_TOPIC,
  evmChainId,
  isQuoteExpired,
  minConfirmations,
  resolveRpcUrls,
  type CryptoBuyerFacing,
  type EvmChain,
  type EvmNetwork
} from "./evm-crypto.constants.js";
import type { CryptoVerifierPort, VerifyCryptoTransferInput, VerifyCryptoTransferResult } from "../domain/ports/crypto-verifier.port.js";

const logger = new Logger("EvmCryptoVerifier");

export class EvmCryptoVerifier implements CryptoVerifierPort {
  async verifyTransfer(input: VerifyCryptoTransferInput): Promise<VerifyCryptoTransferResult> {
    const chain = input.buyerFacing.chain as EvmChain;
    const network = input.buyerFacing.evmNetwork as EvmNetwork;
    logger.log(`[CRYPTO-VERIFY] start txHash=${input.txHash} chain=${chain} network=${network} wallet=${input.walletAddress}`);

    if (isQuoteExpired(input.buyerFacing.quoteExpiresAt)) {
      logger.warn(`[CRYPTO-VERIFY] quote expired: ${input.buyerFacing.quoteExpiresAt}`);
      throw new Error("crypto_quote_expired");
    }

    const rpcUrls = resolveRpcUrls(chain, network);
    if (!rpcUrls.length) {
      logger.error(`[CRYPTO-VERIFY] RPC not configured for ${chain}/${network}`);
      throw new Error("crypto_rpc_not_configured");
    }
    logger.log(`[CRYPTO-VERIFY] using ${rpcUrls.length} RPC endpoint(s), chainId=${evmChainId(chain, network)}`);

    const viemChain = resolveViemChain(chain, network);

    // Try each RPC in order; on rate-limit/timeout, fall through to next
    const hash = input.txHash.trim() as Hash;
    let receipt: Awaited<ReturnType<ReturnType<typeof createPublicClient>["getTransactionReceipt"]>> | undefined;
    let currentBlock: bigint | undefined;
    let lastRpcError: Error | undefined;

    for (const rpcUrl of rpcUrls) {
      try {
        const client = createPublicClient({ chain: viemChain, transport: http(rpcUrl) });
        receipt = await client.getTransactionReceipt({ hash });
        currentBlock = await client.getBlockNumber();
        logger.log(`[CRYPTO-VERIFY] RPC ${rpcUrl} succeeded`);
        break;
      } catch (err: any) {
        lastRpcError = err;
        const msg = err?.message || String(err);
        // Rate limit, timeout, or server error → try next provider
        if (msg.includes("rate limit") || msg.includes("429") || msg.includes("timeout") || msg.includes("503") || msg.includes("502")) {
          logger.warn(`[CRYPTO-VERIFY] RPC ${rpcUrl} failed (retryable): ${msg.slice(0, 120)}`);
          continue;
        }
        // Non-retryable error (bad tx hash, etc.) → throw immediately
        throw err;
      }
    }

    if (!receipt || currentBlock === undefined) {
      logger.error(`[CRYPTO-VERIFY] all ${rpcUrls.length} RPC endpoints failed`);
      throw lastRpcError ?? new Error("crypto_rpc_all_failed");
    }

    logger.log(`[CRYPTO-VERIFY] receipt status=${receipt.status} block=${receipt.blockNumber} logs=${receipt.logs.length}`);
    if (receipt.status !== "success") {
      logger.warn(`[CRYPTO-VERIFY] tx not successful: ${receipt.status}`);
      throw new Error("crypto_tx_not_successful");
    }

    const confirmations = Number(currentBlock - receipt.blockNumber) + 1;
    logger.log(`[CRYPTO-VERIFY] confirmations=${confirmations} required=${minConfirmations(network)} (currentBlock=${currentBlock})`);
    if (confirmations < minConfirmations(network)) {
      logger.warn(`[CRYPTO-VERIFY] insufficient confirmations: ${confirmations}/${minConfirmations(network)}`);
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

    logger.log(`[CRYPTO-VERIFY] expected: to=${treasury} value=${expectedValue} from=${wallet} | matches=${matches.length}`);
    if (matches.length === 0) {
      logger.warn(`[CRYPTO-VERIFY] no matching Transfer log — token/treasury/value/sender mismatch`);
      throw new Error("crypto_transfer_not_matched");
    }
    if (matches.length > 1) {
      logger.warn(`[CRYPTO-VERIFY] ambiguous: ${matches.length} matching transfers`);
      throw new Error("crypto_transfer_ambiguous_match");
    }
    logger.log(`[CRYPTO-VERIFY] ✓ VERIFIED transfer from=${matches[0]!.from} value=${matches[0]!.value}`);
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
