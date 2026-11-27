import type { CryptoBuyerFacing } from "../entities/crypto-buyer-facing.type.js";

export const CRYPTO_VERIFIER = Symbol("CRYPTO_VERIFIER");

export type VerifyCryptoTransferInput = {
  txHash: string;
  walletAddress: string;
  buyerFacing: CryptoBuyerFacing;
};

export interface VerifiedCryptoReceipt {
  chainId: number; network: string; chain: string; txHash: string; blockHash: string; blockNumber: string;
  occurredAt?: string; tokenAddress: string; from: string; destinationAddress: string; amountAtomic: string;
}
export type PrivateCryptoReceipt = { kind: "crypto_v1"; quote: CryptoBuyerFacing; transfers: VerifiedCryptoReceipt[] };
export type VerifyCryptoTransferResult = {
  receipt?: VerifiedCryptoReceipt;
  from: string;
};

export interface CryptoVerifierPort {
  verifyTransfer(input: VerifyCryptoTransferInput): Promise<VerifyCryptoTransferResult>;
}
