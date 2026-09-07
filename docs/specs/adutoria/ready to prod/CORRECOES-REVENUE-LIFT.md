# API-034 — Receita incremental por população medida

Implementado localmente em `master`, em 2026-09-07.

O contrato público de checkout continua em reais: `order_total: 100` significa
R$100. A conversão para `10000` acontece somente ao persistir o valor no
registro interno inteiro cujo nome é `*_cents`.

O cálculo principal do Revenue Lift deixou de usar `attribution_tags` como
denominador. Ele agora parte de todas as `checkout_sessions` que possuem cohort
na janela e associa somente `completed_orders` com status `approved`. Assim,
sessões que não converteram participam da média por sessão e cancelamentos não
entram como receita. O detalhamento por recurso continua marcado como parcial e
não é exibido enquanto sua persistência não tiver uma cadeia durável própria.

O payload `GET /analytics/revenue-lift` recebeu `dataQuality`. A API só expõe
lift quando ambos os cohorts têm pelo menos 30 sessões e o controle possui uma
receita aprovada de referência. Antes disso, os campos de lift são `null` e o
dashboard informa quais dados faltam. As linhas diárias seguem a mesma amostra
mínima para não exibir ganho diário sem base suficiente.

Foi incluído um índice por merchant, cohort e criação para a consulta da
população de sessões.

Validação executada:

- testes de domínio e cálculo do Revenue Lift, incluindo a nova barreira de
  amostra: 25 passaram;
- teste direcionado de `CompleteOrderUseCase` para R$100 → `10000`: passou.
- `pnpm --filter @zyon/api build`: passou, incluindo geração do Prisma Client.
- `pnpm --filter @zyon/dashboard exec tsc -p tsconfig.json --noEmit`: passou.

O teste completo de `complete-order.use-case.spec.ts` ainda contém uma falha
anterior e independente no caso de envio de tracking por WhatsApp: o teste
espera `tracking_code` em um evento que não é produzido por esse fluxo. Ela não
é encoberta por esta correção.

O gate de produção permanece aberto até aplicar a migração, executar a consulta
em PostgreSQL com dados reais, reconciliar sessões e pedidos aprovados e validar
a persistência durável do detalhamento por recurso.
