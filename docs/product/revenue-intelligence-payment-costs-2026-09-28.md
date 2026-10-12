# Revenue Intelligence — taxas de pagamento por estratégia

Vigésima nona entrega local. A medição passa a apresentar as taxas de plataforma e provedor confirmadas para os pedidos aprovados de cada grupo. O dashboard diferencia cobertura completa, dados parciais, ausência de confirmação e taxa confirmada igual a zero. Não calcula lucro ou margem a partir de custos incompletos.

## Vínculo e evidência financeira

- Usa a mesma consulta e visão transacional dos participantes, pedidos e demais métricas. Mantém os não compradores no denominador e considera taxas apenas dos pedidos dentro da janela de conversão das sessões maduras.
- O pedido deve corresponder exatamente à loja, sessão e referência de pagamento do provedor. Valor do pedido, valor cobrado e valor aprovado precisam coincidir em BRL. Não há associação por valor aproximado, comprador ou simples presença de um pagamento na sessão.
- Exige um plano financeiro original da mesma moeda/provedor e a última observação registrada até a coleta. A observação deve estar confirmada e identificar o mesmo pagamento; bruto, taxas e líquido precisam ser completos, não negativos e fechar em centavos. Planejamento não vira confirmação.
- Seleciona primeiro a última observação, inclusive quando incompleta ou bloqueada. Não volta a uma confirmação anterior nem soma snapshots do mesmo pagamento. Uma observação posterior torna a cobertura indisponível quando não há prova completa; não compõe confirmações parciais de eventos diferentes.
- Somente o total de um grupo com todos os pedidos cobertos aparece como confirmado. O contrato preserva o subtotal conhecido e a contagem de cobertura; valores ausentes e estouro numérico não viram zero.
- A evidência agregada e seu hash são salvos na medição imutável. Uma nova observação pode mudar a próxima coleta, sem reescrever a anterior. IDs de compradores, pagamentos e provedores não saem pela API de métricas.

## Dashboard e compatibilidade

A comparação ganhou a linha “Taxas de pagamento confirmadas (R$)” e a contagem de pedidos cobertos. A leitura de medições antigas continua funcionando quando o campo não existe. Falhas de atualização preservam a última medição com sua data. Não houve migration, chamada paga ou alteração de flags.

## Evidência local

- 24 cenários PostgreSQL focados passaram, incluindo cinco testes novos de taxas e regressões de métricas, custos do catálogo e acompanhamento. Os testes novos abrangem duplicação, histórico, cobertura parcial, taxa zero, treze observações incompletas/inconsistentes, sete incompatibilidades de pagamento, maturidade e estorno.
- A regressão integral final passou nos 193 testes PostgreSQL de execução, sem falhas ou casos ignorados. Inclui as correções de navegação e equivalência das entregas anteriores, orçamento, atribuição, concorrência, publicação, cadastro, pagamento, encerramento e recuperação. O tempo ampliado de transação pertence à fixture Docker; a execução não comprova desempenho de produção.
- Nove testes de domínio e agregação passaram, incluindo limites numéricos. TypeScript da API e do dashboard passaram.
- Duas jornadas de navegador passaram, em 1440 e 390 pixels: revisão, alternativas, recusa, resultados, cobertura parcial, zero confirmado, medição antiga, falha de atualização e isolamento entre versões. A API do navegador é simulada. Capturas foram inspecionadas com a linha de taxas visível.
- Logs em `.audit/revenue-weekly/`: `payment-costs-pg.log`, `payment-costs-pg-full.log`, `payment-costs-unit.log`, `payment-costs-api-types.log`, `payment-costs-dashboard-types.log` e `payment-costs-browser-final.log`.

## Limites

Os dados financeiros dos testes são artificiais, persistidos em PostgreSQL descartável; não houve cobrança, webhook externo ou conciliação de provedor real. Esta cobertura é das taxas de pedidos atualmente aprovados e com janela de compra encerrada. Custos de tentativas recusadas, pedidos cancelados/estornados, frete, tributos e outras chamadas de IA não estão incluídos. Receita e taxas isoladas não comprovam contribuição incremental.

Aprovação/ativação pública, paridade completa dos contextos e ferramentas comerciais, economia integral, incentivos, aprendizado entre lojas e demais canais permanecem pendentes. Sem implantação.
