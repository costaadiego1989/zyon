# Auditoria da API — primeira etapa

A API foi revisada antes do cruzamento dos fronts. Veredito: **F — CRITICAL / NO-GO** para a superfície atual, pelos P0 de isolamento, identidade e verdade financeira. Foram inventariados 42 diretórios de domínio com TypeScript, mais knowledge-base sem implementação ativa, e infraestrutura compartilhada.

[Índice geral](<../README.md>) · [ADR compartilhado](<ADR-api-shared.md>)

| Módulo | Veredito | HTTP declarados / alcançáveis | Coesão / acoplamento / boundary / ownership / prontidão |
| --- | --- | --- | --- |
| [agent-rules](<ADR-api-agent-rules.md>) | FAIL | 6 / 6 | 8 / 7 / 7 / 7 / 5 |
| [audit](<ADR-api-audit.md>) | FAIL | 1 / 1 | 7 / 6 / 6 / 7 / 3 |
| [auth](<ADR-api-auth.md>) | FAIL | 7 / 7 | 7 / 6 / 6 / 5 / 2 |
| [buyer-account](<ADR-api-buyer-account.md>) | FAIL | 29 / 25 | 6 / 5 / 5 / 5 / 2 |
| [buyer-purchase-history](<ADR-api-buyer-purchase-history.md>) | FAIL | 1 / 1 | 8 / 6 / 7 / 7 / 4 |
| [cart-recovery](<ADR-api-cart-recovery.md>) | FAIL | 11 / 11 | 7 / 5 / 5 / 3 / 2 |
| [catalog](<ADR-api-catalog.md>) | FAIL | 19 / 19 | 5 / 4 / 3 / 2 / 1 |
| [checkout](<ADR-api-checkout.md>) | FAIL | 17 / 17 | 4 / 3 / 3 / 3 / 1 |
| [checkout-settings](<ADR-api-checkout-settings.md>) | FAIL | 5 / 5 | 8 / 6 / 7 / 7 / 4 |
| [commerce](<ADR-api-commerce.md>) | FAIL | 10 / 9 | 6 / 4 / 5 / 6 / 3 |
| [coupons](<ADR-api-coupons.md>) | FAIL | 5 / 5 | 8 / 6 / 6 / 6 / 3 |
| [cross-sell](<ADR-api-cross-sell.md>) | FAIL | 7 / 0 | 6 / 4 / 5 / 4 / 2 |
| [dashboard](<ADR-api-dashboard.md>) | FAIL | 0 / 0 | 6 / 5 / 5 / 6 / 3 |
| [domains](<ADR-api-domains.md>) | CONDITIONAL | 5 / 5 | 7 / 6 / 6 / 6 / 4 |
| [embed](<ADR-api-embed.md>) | FAIL | 21 / 21 | 6 / 4 / 4 / 4 / 1 |
| [experiments](<ADR-api-experiments.md>) | FAIL | 18 / 18 | 7 / 5 / 6 / 6 / 4 |
| [fulfillment](<ADR-api-fulfillment.md>) | FAIL | 1 / 1 | 7 / 5 / 6 / 6 / 3 |
| [installations](<ADR-api-installations.md>) | FAIL | 6 / 6 | 7 / 5 / 6 / 7 / 4 |
| [integrations](<ADR-api-integrations.md>) | FAIL | 22 / 22 | 6 / 4 / 5 / 6 / 2 |
| [intent-memory](<ADR-api-intent-memory.md>) | FAIL | 4 / 4 | 7 / 5 / 5 / 2 / 2 |
| [inventory](<ADR-api-inventory.md>) | FAIL | 18 / 18 | 5 / 3 / 3 / 3 / 2 |
| [marketplace](<ADR-api-marketplace.md>) | FAIL | 16 / 16 | 4 / 3 / 2 / 2 / 1 |
| [merchant](<ADR-api-merchant.md>) | FAIL | 12 / 12 | 5 / 4 / 5 / 6 / 4 |
| [negotiation](<ADR-api-negotiation.md>) | FAIL | 19 / 19 | 6 / 3 / 4 / 6 / 4 |
| [notifications](<ADR-api-notifications.md>) | FAIL | 0 / 0 | 6 / 4 / 5 / 5 / 2 |
| [onboarding](<ADR-api-onboarding.md>) | FAIL | 2 / 2 | 8 / 6 / 7 / 7 / 3 |
| [operations](<ADR-api-operations.md>) | FAIL | 12 / 12 | 6 / 4 / 5 / 5 / 2 |
| [payment](<ADR-api-payment.md>) | FAIL | 31 / 31 | 4 / 3 / 4 / 4 / 1 |
| [public-api](<ADR-api-public-api.md>) | FAIL | 110 / 7 | 4 / 3 / 3 / 4 / 2 |
| [returns](<ADR-api-returns.md>) | FAIL | 11 / 9 | 6 / 4 / 4 / 4 / 1 |
| [revenue-lift](<ADR-api-revenue-lift.md>) | CONDITIONAL | 2 / 2 | 6 / 5 / 5 / 5 / 3 |
| [revenue-manager](<ADR-api-revenue-manager.md>) | CONDITIONAL | 6 / 6 | 7 / 5 / 6 / 6 / 3 |
| [scraping-agent](<ADR-api-scraping-agent.md>) | CONDITIONAL | 4 / 0 | 7 / 6 / 6 / 6 / 3 |
| [self-checkout](<ADR-api-self-checkout.md>) | FAIL | 12 / 0 | 5 / 4 / 4 / 4 / 2 |
| [shipping](<ADR-api-shipping.md>) | FAIL | 9 / 9 | 6 / 4 / 4 / 6 / 3 |
| [store-analytics](<ADR-api-store-analytics.md>) | CONDITIONAL | 6 / 6 | 7 / 5 / 6 / 6 / 4 |
| [store-settings](<ADR-api-store-settings.md>) | CONDITIONAL | 10 / 10 | 6 / 4 / 5 / 5 / 3 |
| [storefront](<ADR-api-storefront.md>) | FAIL | 17 / 17 | 3 / 2 / 2 / 2 / 1 |
| [stories](<ADR-api-stories.md>) | FAIL | 12 / 12 | 7 / 5 / 3 / 2 / 1 |
| [support](<ADR-api-support.md>) | FAIL | 9 / 9 | 6 / 4 / 2 / 4 / 1 |
| [team](<ADR-api-team.md>) | FAIL | 5 / 5 | 7 / 4 / 4 / 3 / 2 |
| [whatsapp-channel](<ADR-api-whatsapp-channel.md>) | FAIL | 10 / 10 | 5 / 4 / 4 / 5 / 2 |
| [knowledge-base](<ADR-api-knowledge-base.md>) | UNVERIFIED / CAPACIDADE NÃO IDENTIFICADA | 0 / 0 | 0 / 0 / 0 / 0 / 0 |

Alcançável significa encontrado no grafo de @Module, não testado em servidor. Declarados sob @NonProductionRoute dependem da configuração registrada em API-005. Os contratos duplicados e o conjunto de rotas completo estão em [Contratos](<../CONTRATOS.md>).
