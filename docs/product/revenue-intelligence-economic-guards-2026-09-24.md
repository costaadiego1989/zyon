# Inteligência de receita — proteção econômica e contenção do experimento legado

Entrega local na branch `feat/revenue-intelligence-weekly`, sobre `53a8dc4`. Continua o [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md) e a [primeira entrega](revenue-intelligence-first-delivery-2026-09-24.md). Não houve push, implantação, chamada paga de IA ou transação comercial real.

## Comportamento entregue

- `rules-engine` deixa de presumir que mercadorias sem custo custam 50% do preço. Custo ausente, custo de adicionais não modelado, moeda incompatível, total inconsistente ou número inválido impedem a autorização do incentivo. Custo explicitamente zero continua válido. Valores são avaliados em centavos; benefícios arredondam para baixo e despesas para cima.
- A margem estimada usa o custo informado e considera o maior desconto que permanecerá no carrinho, uma única vez. Um desconto já aplicado acima do limite atual impede uma nova autorização.
- Cupons de frete passam pela mesma autoridade das ofertas de frete: cotação com custo da transportadora, região, mínimo do carrinho, permissão de acúmulo, teto do desconto parcial, teto de subsídio e margem. Receita de frete e despesa da transportadora são componentes separados. Frete grátis dispensa o valor cobrado do comprador, que pode ser diferente do custo da transportadora. Um cupom fixo/percentual que dispense todo o frete também precisa satisfazer a política de frete grátis.
- O storefront consulta custos internos por loja/variante ativa, sem enviá-los no carrinho do comprador. Falha na avaliação retira benefícios automáticos anteriores; se houver cupom, a falha é propagada para não devolver uma validação aparente. Regras de frete não concedem gratuidade no carrinho sem cotação autorizável.
- `net-receipts-contribution-v1` define uma função pura de contribuição: recebimentos líquidos menos mercadoria, pagamento, tributos, transportadora, comissão, comunicação e IA. Cada componente ausente mantém o resultado indisponível; desconto já incluído nos recebimentos não é subtraído novamente. O contrato ainda não está alimentado por um ledger econômico completo.
- Revenue Lift passa a mostrar **variação/diferença estimada de receita**. Não apresenta lucro, ROI ou custo total de IA a partir do contador parcial por sessão. A API mantém esse contador em `recordedAiCostCents`; `aiCostCents`, `netLiftCents` e `roiPercent` ficam nulos, assim como a contribuição, até existir conciliação suficiente. O dashboard explica a ausência e exibe “—”.
- Lojas do fluxo semanal ficam impedidas de promover vencedores ou gravar lições pelo mecanismo legado. A restrição usa a participação configurada e a existência da agenda persistida: desligar a flag não devolve a loja ao mecanismo antigo. A rota de promoção preserva o conflito HTTP 409. A conclusão do experimento semanal não gera uma lição de sucesso sem evidência; a geração semanal também exclui lições legadas anteriores.

## Validação

| Verificação | Evidência |
| --- | --- |
| Suíte focada | 677 testes passaram, zero falhas/skips. Engines, cupons, storefront, Revenue Manager/Lift, experimentos e casos afetados de checkout/cross-sell/negociação |
| Ajuste final do limite de desconto acumulado no frete | 19 testes de frete e aplicação de cupons passaram |
| Regressão ampliada | 1.176 passaram, 17 falharam e 1 permaneceu ignorado; nenhum nome de falha novo em relação à base |
| Base `53a8dc4` | Mesma seleção de arquivos existentes, mais arquivamento de cupons: 1.184 passaram, 18 falharam e 1 foi ignorado. Loader local leu a versão HEAD dos arquivos modificados, preservando o checkout |
| TypeScript | API com client Prisma isolado e fontes desta branch para shared-types/rules-engine/shipping-engine; dashboard separado |
| Chromium, API simulada | 1440px e 390px: estimativa, contribuição/custo indisponíveis, amostra insuficiente, reload, ausência de overflow e de erros JavaScript |
| Banco/Redis e produção | Não executados nesta etapa; Docker estava indisponível. Não extrapolar os testes de banco da primeira entrega para estas alterações |

As 17 falhas preservadas pertencem a cadastro/OTP, etapas do checkout, uma expectativa de total após atualizar carrinho, texto do agente e dois testes de arquivamento de cupons. O skip preexistente é de cadastro duplicado por e-mail. Uma expectativa incorreta de cupom percentual foi corrigida: o teste de teto agora pede 100%, em vez de esperar desconto integral ao pedir 50%. Não se trata de uma suíte global verde.

Logs e imagens estão em `.audit/revenue-weekly/economics-*.log` e `economics-{1440,390}.png`. O script rastreado `apps/dashboard/scripts/verify-revenue-economics.mjs` reproduz a verificação visual em `http://127.0.0.1:5186`, interceptando todas as APIs. A regressão usa `apps/api/tests/ready-prod-loader.mjs`, `--test-concurrency=4` e o client indicado em `READY_PROD_TEST_PRISMA_CLIENT`.

## Limites e sequência obrigatória

Esta entrega avança RI-02 e contém o caminho legado de RI-03; **não conclui essas entregas nem libera o piloto**.

1. A autorização ainda usa a hipótese histórica de taxa de pagamento de 4%. É preciso configurar/versionar taxas efetivas, tributos, comissões e demais custos e persistir snapshots econômicos e estornos. Contribuição real e ROI continuam indisponíveis. A função de autorização de desconto de produto ainda não recebe todo o contexto econômico de frete; a avaliação integral da compra permanece pendente.
2. É necessário concluir a revalidação transacional de preço, estoque, custos e política ao aceitar/aplicar benefícios e antes do pagamento. Ainda existem caminhos legados independentes, incluindo aceitação de ofertas já autorizadas e fallback de cross-sell sem contexto econômico completo. Os bloqueios desta etapa não demonstram proteção universal de todos os canais.
3. Os gates estatísticos precisam de plano prévio versionado, controle identificado, população completa, maturidade, incerteza e duração. Sete dias permitem uma revisão; não provam sucesso. A promoção semanal está bloqueada até a implementação do fluxo de decisão e aprovação correspondente. A contenção atual também não substitui um fence transacional entre migração e execução concorrente de jobs antigos.
4. Completar RI-06/07/08: proposta estruturada, versão imutável, pedido de alternativa pelo lojista, aprovação concorrente/idempotente, ativação e métricas da estratégia. Depois habilitar cupons inteligentes e biblioteca de padrões entre lojas com evidência, privacidade e testes locais. Nenhum aprendizado entre lojas foi ativado.
5. Repetir o ensaio da migration SQL e validar a aplicação com banco/Redis antes de liberar as flags. Nesta etapa não foi criada nova migration.

As alterações econômicas dos engines têm alcance global no código e não dependem da flag semanal. Lojas sem custos completos passarão a ter incentivos recusados; produtos com adicionais exigem modelagem do custo dos adicionais. A mudança de nulabilidade das métricas exige consumidores compatíveis. Esses impactos precisam ser considerados na revisão e implantação coordenada. O merge/deploy não foi executado.
