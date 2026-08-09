import type { CryptoBuyerFacing } from "../entities/crypto-buyer-facing.type.js";

export const CRYPTO_VERIFIER = Symbol("CRYPTO_VERIFIER");

export type VerifyCryptoTransferInput = {
  txHash: string;
  walletAddress: string;
  buyerFacing: CryptoBuyerFacing;
};

export type VerifyCryptoTransferResult = {
  from: string;
};

export interface CryptoVerifierPort {
  verifyTransfer(input: VerifyCryptoTransferInput): Promise<VerifyCryptoTransferResult>;
}
