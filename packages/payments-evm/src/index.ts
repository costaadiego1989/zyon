/**
 * @zyon/payments-evm
 *
 * Universal EVM payments provider. Replaces the legacy @zyon/payments-stellar.
 *
 * Capabilities:
 *   - createNativePaymentIntent / createErc20PaymentIntent / createPaymentIntent
 *   - encodeIntent  (produces calldata/value for the buyer's wallet)
 *   - verifyTransaction / verifyIntent (against a viem PublicClient)
 *   - getNativeBalance / getErc20Balance / formatBalance
 *
 * Supported chains (see ./chains.ts):
 *   - Ethereum mainnet (1)
 *   - Polygon (137)
 *   - BNB Smart Chain (56)
 *
 * Supported tokens:
 *   - USDT and USDC, with per-chain decimals (USDT: 6 on ETH/Polygon, 18 on BSC; USDC: 6).
 */
export * from "./chains.js";
export * from "./types.js";
export * from "./intent.js";
export * from "./verify.js";
export * from "./balance.js";