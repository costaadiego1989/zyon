# Maturity Index (ADR-0007)

Tracks module/capability maturity (L0–L4) and progressive closure (P0–P4)
for the AACP API and widget.

- ADR: [0007 — Module maturity and progressive closure](../../docs/architecture/adr/0007-module-maturity-and-progressive-closure.md) (Status: aceito)
- Cross-platform blockers: [p0-blockers.md](./p0-blockers.md)

Levels: `L0` Scaffold · `L1` Domínio local · `L2` Integrado ·
`L3` Pilot-ready · `L4` Production-ready.
Level = menor garantia do fluxo, não a média. Bloqueio crítico de
segurança/persistência/consistência impede `L3`.

## P0 — Cross-platform blockers

Nenhum módulo chega a L3 e o piloto não inicia enquanto P0 não fechar.
Status detalhado em [p0-blockers.md](./p0-blockers.md).

## API modules

| Module | Level | Target | Priority | Sheet |
|---|---|---|---|---|
| auth | L2 | L3 | P2 | [auth.md](./auth.md) |
| merchant | L2 | L3 | P2 | [merchant.md](./merchant.md) |
| agent-rules | L2 | L3 | P2 | [agent-rules.md](./agent-rules.md) |
| checkout-settings | L2 | L3 | P2 | [checkout-settings.md](./checkout-settings.md) |
| buyer-purchase-history | L2 | L3 | P2 | [buyer-purchase-history.md](./buyer-purchase-history.md) |
| checkout | L2 (blocked) | L3 | P1 | [checkout.md](./checkout.md) |
| embed | L2 (blocked) | L3 | P1 | [embed.md](./embed.md) |
| payment | L2 (blocked) | L3 | P1 | [payment.md](./payment.md) |
| commerce | L1 | L3 | P1 | [commerce.md](./commerce.md) |
| negotiation | L2 | L3 | P2 | [negotiation.md](./negotiation.md) |
| cross-sell | L1 | L3 | P3 | [cross-sell.md](./cross-sell.md) |
| coupons | L1 | L3 | P3 | [coupons.md](./coupons.md) |
| shipping | L1 | L3 | P1 | [shipping.md](./shipping.md) |
| fulfillment | L1 | L3 | P3 | [fulfillment.md](./fulfillment.md) |
| integrations | L2 | L3 | P2 | [integrations.md](./integrations.md) |
| support | L2 | L3 | P2 | [support.md](./support.md) |
| buyer-account | L2 (blocked) | L3 | P2 | [buyer-account.md](./buyer-account.md) |
| self-checkout | L1 | L3 | P4 | [self-checkout.md](./self-checkout.md) |
| scraping-agent | L0-L1 | L3 | P4 | [scraping-agent.md](./scraping-agent.md) |

## Widget capabilities

| Capability | Level | Target | Priority | Sheet |
|---|---|---|---|---|
| shell-embed | L2 | L3 | P2 | [widget-shell-embed.md](./widget-shell-embed.md) |
| chat-collection | L2 | L3 | P2 | [widget-chat-collection.md](./widget-chat-collection.md) |
| cart | L1 (critical) | L3 | P1 | [widget-cart.md](./widget-cart.md) |
| shipping-widget | L2 | L3 | P1 | [widget-shipping.md](./widget-shipping.md) |
| cross-sell-coupon | L2 | L3 | P3 | [widget-cross-sell-coupon.md](./widget-cross-sell-coupon.md) |
| pix | L2 | L3 | P1 | [widget-pix.md](./widget-pix.md) |
| card | L1 (critical) | L3 | P1 | [widget-card.md](./widget-card.md) |
| confirmation | L2 | L3 | P1 | [widget-confirmation.md](./widget-confirmation.md) |
| auth-buyer-hub | L1-L2 | L3 | P2 | [widget-auth-buyer-hub.md](./widget-auth-buyer-hub.md) |
| support-widget | L2 | L3 | P2 | [widget-support.md](./widget-support.md) |
| theme-responsiveness | L2 | L3 | P2 | [widget-theme-responsiveness.md](./widget-theme-responsiveness.md) |
| accessibility | L1-L2 | L3 | P2 | [widget-accessibility.md](./widget-accessibility.md) |
| contracts-sdk | L2 | L3 | P2 | [widget-contracts-sdk.md](./widget-contracts-sdk.md) |

## Closure order (ADR-0007)

- **P0** — Baseline confiável e segurança financeira (transversal).
- **P1** — Caminho transacional do piloto: checkout, embed, payment,
  commerce, shipping + cart, shipping, pix, card, confirmation (widget).
- **P2** — Identidade e operação do merchant: auth, merchant, agent-rules,
  checkout-settings, buyer-account, buyer-purchase-history, integrations,
  support, negotiation + auth/buyer-hub/support (widget).
- **P3** — Growth e logística: cross-sell, coupons, fulfillment
  (só após P1 em L3).
- **P4** — Expansão pós-piloto: self-checkout, scraping-agent, otimizações.

Nenhum item P3/P4 deve atrasar bloqueios P0/P1.

## Governança

- Código e gates são a fonte de verdade operacional.
- Cada ficha mantém nível atual/alvo, owner, fluxos, links e riscos aceitos.
- Mudanças de ownership, segurança, persistência ou semântica de eventos
  exigem ADR específico referenciando o 0007.
