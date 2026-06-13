# ADR 0027 — Payment: Crypto EVM (Polygon/Base, USDC)

- **Status:** aceito
- **Data:** 2026-06-13
- **Decisores:** Engenharia (Payment), Produto
- **Relacionado:** [ADR 0011](./0011-payment-hardening.md), [ADR 0022](./0022-widget-transactional-path.md), [ADR 0016](./0016-merchant-config-surface-hardening.md)

## Contexto

Merchants need an optional crypto payment method for buyers using MetaMask and Trust Wallet. Stellar was considered but rejected in favor of EVM (Polygon MVP, Base optional) for native wallet support.

## Decisão

- **Per-tenant opt-in** via `MerchantRules.cryptoPayments` with treasury address on merchant wallet (non-custodial platform).
- **Token:** USDC ERC-20 only in MVP.
- **Quote server-side:** BRL total converted using merchant `brlPerUsdc` manual rate; TTL enforced.
- **Confirmation:** buyer submits tx hash; API verifies via public RPC (viem), then `completeAfterApproval` same as Asaas webhook path.
- **Widget:** wagmi + WalletConnect; lazy-loaded crypto panel.
- **No LLM authorization** of crypto payments.

## Alternativas consideradas

- **Stellar + Freighter.** Rejeitado: user chose EVM for MetaMask/Trust native UX.
- **Smart contract router with intentId.** Deferred to phase 2; direct ERC-20 transfer for MVP.
- **Automatic price oracle.** Deferred; manual `brlPerUsdc` for MVP.

## Consequências

**Positivas:** optional revenue channel; wallet-native UX; reuses payment intent model.

**Riscos:** manual FX rate; RPC dependency; buyer must use exact network and amount.

**Barra de aceite:** testnet E2E with `mrc_dev_seed`; unit tests for quote and log verification.
