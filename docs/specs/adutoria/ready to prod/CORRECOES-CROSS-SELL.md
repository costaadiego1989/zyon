# Correção API-035 — Cross-sell com catálogo autoritativo

## Decisão

O widget ativo recebe `experience.suggestedProducts` pelo checkout e inclui itens pelo fluxo de conversa. A API já monta `CrossSellModule`; o endpoint dedicado `/embed/cross-sell/*` permanece fora da superfície HTTP porque o widget não o consome e sugestões transitórias não têm registro persistido para um aceite auditável.

## Implementação

- o resolvedor não cria fallback de SKU, nome, preço ou custo; SKU inexistente, inativo, sem preço comercial ou sem saldo físico disponível retorna `null`;
- preço e custo do checkout continuam em reais; apenas a leitura do inteiro interno do catálogo converte centavos para reais;
- recomendador e estratégias excluem produto/variante inativos, produto excluído e estoque líquido indisponível (`quantity - reserved`); digitais e serviços não dependem de estoque físico;
- aceite e recusa exigem sugestão da mesma sessão; o aceite valida todos os SKUs no catálogo antes de mudar sugestão ou carrinho.

## Compatibilidade

Não houve mudança de endpoint, body ou unidade monetária para storefront, widget_v2 ou checkout. Itens que deixaram de ser sugeridos já não estavam disponíveis para venda e seriam rejeitados na confirmação de pagamento.

## Validação local

- `node --loader ./tests/ready-prod-loader.mjs --test ./src/modules/cross-sell/application/services/cross-sell-product-resolver.spec.ts ./src/modules/cross-sell/application/services/checkout-cross-sell-recommender.spec.ts ./src/modules/cross-sell/application/use-cases/cross-sell.use-cases.spec.ts ./src/modules/cross-sell/domain/entities/cross-sell-entities.spec.ts ./src/modules/cross-sell/domain/policies/cross-sell-policies.spec.ts ./src/modules/cross-sell/domain/services/cross-sell-recommender.service.spec.ts` — 53 testes aprovados.
- `pnpm --filter @zyon/api build` — aprovado.

## Gate de produção

Aplicar migrations pendentes e executar smoke com catálogo real: produto físico com estoque, sem estoque, digital e tentativa de usar sugestão de outra sessão. Publicar o endpoint dedicado só com contrato versionado e integração no widget.
