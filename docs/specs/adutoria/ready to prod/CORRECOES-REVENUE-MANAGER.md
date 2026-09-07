# API-033 — Métricas observadas com proveniência

Implementado localmente em `master`, em 2026-09-07.

O Revenue Manager deixou de estimar estágios do funil e abandono por frações
fixas. Agora usa somente os eventos que o checkout realmente registra:
`checkout_started`, `shipping_option_selected`, `payment_method_selected`,
`shipping_objection_detected`, `payment_failed` e `checkout_abandoned`.

Cada observação persiste `data_quality_json`, com janela, amostra, fontes e
métricas ausentes. Sem ao menos 30 sessões, eventos de checkout e o evento de
início, as taxas de conversão e abandono são `null`, o estado é `insufficient_data` e o job não chama
o gerador de hipóteses. A mesma barreira existe no use case, portanto uma
chamada direta também não consegue produzir uma hipótese com dados sem
proveniência. Observações legadas sem esse campo são reidratadas como
insuficientes.

O dashboard recebeu o contrato nullable para conversão: exibe `Dados
insuficientes` em vez de converter uma ausência em `0%`. Os totais de receita,
pedidos e custos continuam agregados diretamente do banco. A sensibilidade a
desconto passa a `null` até haver uma projeção medida de histórico de compra.

Validação executada:

- `node --loader ./tests/ready-prod-loader.mjs --test ./src/modules/revenue-manager/application/use-cases/observe-metrics.measurement.spec.ts ./src/modules/revenue-manager/application/__tests__/generate-hypothesis-governance.spec.ts ./src/modules/revenue-manager/application/__tests__/use-cases.spec.ts ./src/modules/revenue-manager/domain/__tests__/entities.spec.ts` — 70 testes passaram.
- `pnpm --filter @zyon/api build` — passou, incluindo geração do cliente Prisma.
- `pnpm --filter @zyon/dashboard exec tsc -p tsconfig.json --noEmit` — passou.
- `pnpm --filter @zyon/dashboard build` chegou ao Vite, mas este não pôde ler `vite.config.ts` por permissão do ambiente. Não houve falha de TypeScript.

O gate de produção continua aberto até aplicar a migração, executar uma janela
real com eventos medidos e verificar o job no ambiente de produção. Ainda falta
uma projeção de sensibilidade a desconto baseada em histórico de compra; a
ausência dela está explícita no payload e não recebe valor inventado.
