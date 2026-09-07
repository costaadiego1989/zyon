# API-032 — Contexto de compra limitado e inserção idempotente

Implementado localmente em `master`, em 2026-09-07.

O caminho de conclusão de pedido não reidrata mais o histórico completo depois
de salvar uma compra. A inserção usa a unicidade de `(merchant_id, order_id)`:
uma repetição concorrente ou posterior é marcada como idempotente e não regrava
o pedido já concluído.

O contexto usado por recuperação de carrinho e pelas APIs de comprador passou
a ter duas fontes de dados: `count/sum/max` do banco para `orders_count`, LTV,
ticket médio e último pedido; e no máximo 100 pedidos dos últimos 12 meses para
categorias, SKUs recentes e sensibilidade a desconto. As consultas têm índices
compostos por merchant, identidade do comprador e data de conclusão.

`getByBuyer` continua como compatibilidade para consumidores que realmente
precisam de registros individuais, mas retorna no máximo os 100 mais recentes.
Os consumidores de contexto foram transferidos para `getContext`, que mantém
os totais exatos sem carregar todos os itens em memória.

Validação executada:

- `node --loader ./tests/ready-prod-loader.mjs --test ./src/modules/buyer-purchase-history/application/buyer-purchase-history.use-cases.spec.ts ./src/modules/buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.spec.ts ./src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.spec.ts ./src/modules/buyer-purchase-history/domain/entities/buyer-purchase-history.entity.spec.ts ./src/modules/buyer-purchase-history/presentation/http/buyer-purchase-history.controller.spec.ts ./src/modules/cart-recovery/__tests__/recovery-scanner.spec.ts` — 11 testes passaram.
- `pnpm --filter @zyon/api build` — passou, incluindo geração do cliente Prisma.
- `prisma format --schema prisma/schema.prisma` e `git diff --check` — passaram.

O teste de unidade simula um comprador com 100.000 pedidos e verifica que a
projeção pede `take: 100`, preservando os totais agregados. Ainda falta executar
`EXPLAIN ANALYZE` e o teste de concorrência contra PostgreSQL descartável com a
migração aplicada; Docker não está disponível neste ambiente. O status é
`IMPLEMENTED_LOCAL_VALIDATION` e o gate de produção continua aberto.
