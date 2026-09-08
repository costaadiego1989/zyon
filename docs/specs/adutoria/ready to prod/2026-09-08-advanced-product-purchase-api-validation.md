# Validação local de regras e compra — 2026-09-08

Escopo: suporte da API ao layout avançado, regras de produto, opcionais de comida, OTP por e-mail e testes locais de compra. Nenhum dado de cliente, pagamento real ou ambiente de produção foi utilizado. Este relatório não declara o fluxo completo pronto para produção.

## Evidências executadas

- `pnpm --filter @zyon/api test:advanced-product-layout`: dependências compilaram; a etapa `prisma generate` parou com `EPERM` ao renomear `query_engine-windows.dll.node`, enquanto a API local estava em execução.
- Compilação alternativa isolada em `apps/api`: `pnpm exec tsc -p tsconfig.build.json --outDir .audit/purchase-rules-validation --incremental false` — passou.
- `node .audit/purchase-rules-validation/advanced-product-layout-test-runner.js` — **83 passaram, 0 falharam, 0 ignorados**.
- `node .audit/purchase-rules-validation/buyer-email-otp-test-runner.js` — **23 passaram, 0 falharam, 0 ignorados**.
- `node --test .audit/purchase-rules-validation/modules/checkout/presentation/http/checkout.full-purchase-flow.e2e-spec.js .audit/purchase-rules-validation/modules/checkout/presentation/http/checkout.payment-flow.e2e-spec.js .audit/purchase-rules-validation/modules/payment/presentation/http/stripe-webhook.e2e-spec.js` — **2 passaram, 9 falharam**. Todas as falhas ocorreram antes da compra: `checkout_cart_authority_unavailable`.

As duas suites aprovadas validam condições AND, prioridade e primeira regra correspondente, operadores do dashboard, categoria/SKU, variações ativas, teto percentual do lojista, teto em reais, opções obrigatórias de comida, preços calculados a partir do catálogo, frete autorizado, nudges, ofertas expiradas e entrega/consumo seguro de OTP com provedores simulados. A persistência de regras nesses testes usa repositório em memória; não constitui prova de escrita e releitura no PostgreSQL.

## Pendências confirmadas

1. **Fixtures antigas de compra:** `start-checkout.fixture.ts` permite omitir a autoridade do carrinho, mas `StartCheckoutUseCase` exige essa dependência e falha de modo seguro. As fixtures de `checkout.full-purchase-flow.e2e-spec.ts`, `checkout.payment-flow.e2e-spec.ts` e `stripe-webhook.e2e-spec.ts` precisam de catálogo independente do payload do comprador. Também devem estabelecer os pré-requisitos de identidade/frete pelo lado do servidor. Nenhuma proteção de runtime foi removida, nem fixture incompleta foi mantida nesta rodada.
2. **Compre 1 e ganhe 1:** não implementado como ação financeira. `UpsertProductAdvancedRulesUseCase` rejeita `buy_one_get_one`, com teste aprovado específico. Desconto percentual condicionado a produto/categoria não equivale a adicionar um brinde ou aplicar desconto somente à unidade beneficiada.
3. **Margem no carrinho storefront:** `CartRulesEngine.toEngineCart` não fornece custo dos itens; `StorefrontCartItem` não contém esse dado. `estimateMargin` usa 50% do preço quando o custo está ausente. Logo o limite percentual/reais é aplicado, mas a margem mínima no storefront não é garantida com o custo real do catálogo. `CheckoutCartAuthorityService.resolveStorefront` carrega os custos reais posteriormente, porém transporta o desconto persistido sem reavaliar essa regra nessa função. Achado por inspeção de código; a correção de runtime ficou fora desta entrega visual.
4. **Stripe sandbox real:** não executado. Os testes de webhook inspecionados usam `FakeStripeProvider`, eventos construídos localmente e repositório em memória. Não houve cobrança sandbox, Stripe Elements, 3DS, entrega real de webhook ou confirmação em banco nesta validação.

## Limite da conclusão

Há evidência local favorável para renderização de contratos e regras suportadas, mas não para afirmar que todas as modalidades promocionais solicitadas ou o pagamento sandbox completo estão concluídos. Os testes de navegador do storefront são registrados separadamente pela frente de UI.
