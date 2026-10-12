# Revenue Intelligence — custo de produtos preservado por pedido

Vigésima primeira entrega local no branch `feat/revenue-intelligence-weekly`. Congela o custo cadastrado das variantes quando um pedido participante é registrado e apresenta a cobertura dessa informação no resultado da estratégia. Sem implantação, ativação ou operações externas.

## Captura e autoridade

`StrategyOrderCostSnapshot` nasce na mesma transação do primeiro registro de `CompletedOrder`, por trigger. Só pedidos com uma participação imutável recebem a captura. Pedidos históricos, holdout e sessões sem atribuição não são reconstruídos retroativamente. Rollback remove pedido e captura juntos; repetição idempotente preserva a primeira captura.

O custo vem de `ProductPrice`, com variante canônica vinculada a um produto da própria loja e à moeda do pedido. Não usa `cart.items[].cost`. Preserva preço de origem, atualização do cadastro, quantidade, custo unitário, total por linha e taxa configurada como metadado. Esta captura representa custo cadastrado no momento do registro do pedido; não comprova custo efetivamente realizado ou tributo devido.

Itens ausentes ou inválidos, variante sem preço, custo ausente/negativo, moeda incompatível, opção adicional sem custo verificado e estouro de representação monetária mantêm o custo total indisponível com motivo explícito. O registro normal do pedido continua. Zero só é aceito quando cadastrado como custo da variante; ausência não vira zero.

A captura não aceita gravação direta por endpoint/Prisma e não pode ser atualizada ou excluída. A linha de pedido que deu origem a ela preserva identidade, loja, sessão, moeda, data e itens. Status de reembolso/cancelamento, rastreio e correções de valor continuam pelo fluxo existente, sem reescrever o custo original. Uma mudança posterior de custo no catálogo não altera a venda já registrada.

## Medição e painel

A coleta consulta captura e pedido no mesmo instante de leitura dos demais resultados. Conta somente pedidos aprovados das sessões maduras da mesma execução e dentro da janela de conversão. Capturas posteriores ao horário de referência ficam de fora. Preserva quantidade de pedidos, capturas e custos completos; o total cadastrado do grupo só é mostrado quando todos os pedidos considerados têm cobertura. O subtotal conhecido permanece separado na evidência quando a cobertura é parcial.

O dashboard mostra o custo cadastrado em reais e a proporção de pedidos cobertos. Explica que esse componente exclui frete, taxas e outros custos. Contribuição, lucro e custo total de IA permanecem indisponíveis; esta entrega não transforma custo de catálogo em margem garantida e não libera descontos ou cupons.

## Validação local

Schema validado e cliente Prisma gerado isoladamente. A migration aditiva `20260925040000_strategy_order_catalog_cost` foi aplicada apenas ao banco descartável local, com diff de schema vazio. O SQL final também foi ensaiado integralmente em uma transação revertida nesse banco: recriou as estruturas sobre pedidos existentes e verificou ausência de backfill. Atualizar o banco e o cliente é pré-requisito do código de medição, inclusive com a estratégia desabilitada. Não há ensaio de toda a cadeia de `migrate deploy`.

Os cinco cenários novos exercitam repositório real, custo forjado no carrinho, mudança de catálogo, repetição, rejeição de mutação, outra loja, linhas inválidas, opções sem custo, overflow, rollback, ausência de backfill e cobertura parcial. Os seis cenários de medição, dois de metadados de tenant e os 12 de regressão legada também passaram: 25 testes distintos. Após proteger os itens do pedido, os cinco cenários de custo e o de correção por reembolso passaram novamente. TypeScript da API aprovado.

TypeScript do dashboard aprovado. As duas jornadas completas de navegador passaram em desktop/celular, incluindo 720/320 px, custo conhecido versus indisponível, cobertura parcial, atualização com falha e troca de versão. Usam API HTTP controlada; não são vendas reais nem um teste ponta a ponta da API. Evidências em `.audit/revenue-weekly/catalog-cost-*.log` e `catalog-cost-ui`, fora do commit.

## Continuação

Ainda faltam componentes financeiros e de IA com cobertura verificável, regras de parada, acompanhamento operacional e aprovação ligada à ativação. O tratamento de custos de devolução/restoque, custos de opções, taxas e frete requer suas respectivas fontes. Paridade do checkout, incentivos e aprendizagem compartilhada mantêm os critérios do plano técnico; não há piloto comercial concluído.
