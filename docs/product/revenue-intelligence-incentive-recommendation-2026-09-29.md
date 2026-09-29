# Sugestão automática de teste de desconto

Entrega 42, em 29/09/2026. Complementa o [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md), a [simulação semanal](revenue-intelligence-weekly-discount-study-2026-09-29.md) e os [limites financeiros da loja](revenue-intelligence-incentive-policy-2026-09-29.md).

## Comportamento implementado

O motor prepara uma sugestão de incentivo junto da análise semanal. O lojista configura os limites gerais previamente; não precisa escolher valores, montar público ou desenhar o teste. O cálculo usa o estudo de descontos e a política financeira da própria loja, sem chamada adicional à LLM.

A sugestão inclui percentual, teto por compra, orçamento máximo, quantidade de usos, um uso por comprador, faixa de carrinho, intenção e consentimento, margem mínima, duração de sete dias após aprovação específica, divisão 50/50, exclusão do holdout e proibição de acumular outros cupons ou incentivos. Define conversão em pedido aprovado por comprador como métrica principal e prevê acompanhamento de gasto com desconto, margem configurada e devoluções. Esses termos são uma recomendação, não um resultado medido ou uma autorização para gastar.

O teto por compra é o menor entre o desconto máximo da simulação e os limites financeiros da loja. A quantidade de usos respeita tanto o limite configurado quanto a quantidade de descontos máximos que cabe no orçamento. O orçamento sugerido é o produto desses dois valores inteiros; pode ficar abaixo do teto configurado. Por exemplo, teto de R$ 105,00 e R$ 4,00 por compra admitem 26 usos e um orçamento de R$ 104,00. Não se usa a soma dos descontos históricos como previsão de demanda ou gasto futuro.

O estudo continua sendo uma simulação com custos do catálogo e taxa de pagamento assumida; não inclui toda a economia da operação. Margem mínima é uma condição a revalidar antes de cada oferta, não uma afirmação de lucro líquido. A duração de sete dias não garante amostra suficiente nem resultado conclusivo. As últimas participações ainda precisam completar a janela de conversão de 168 horas após o fim das entradas. O planejamento estatístico específico precisa estar pronto antes da ativação do incentivo.

## Persistência, revisão e notificação

`weekly-incentive-recommendation-v1` é armazenado no mesmo primeiro registro do estudo, antes do despacho ao modelo, dentro da transação com isolamento `REPEATABLE READ` e verificação da lease. Congela loja, ciclo, observação, hash do estudo e versão/hash dos limites financeiros. Concorrência converge para o mesmo documento; novas tentativas não recalculam usando vendas ou configurações posteriores.

Ausência de candidato seguro e política financeira desligada são resultados diferentes. Ambos ficam registrados até a próxima análise; habilitar limites ou receber vendas novas não reabre a análise da semana. Estudos antigos permanecem sem recomendação anexada: não há backfill.

A publicação lê a recomendação do ciclo no servidor, valida o documento e inclui seu conteúdo no hash da proposta. Proposta e notificação confirmam na mesma transação. Quando existe sugestão de incentivo, o aviso informa que há um teste de desconto para consultar. Ler os detalhes não chama a LLM nem reserva dinheiro.

Revisões da comunicação conservam os termos de incentivo congelados e não os enviam como instrução à LLM. Uma consulta da proposta compara sua política financeira com a atual, retornando `incentivePolicyCurrent` por versão, fora do documento imutável. Se os limites mudaram, o dashboard conserva os valores históricos e informa que a próxima análise considerará os novos limites. Isso não autoriza gastar com os limites antigos. Uma alternativa comercial que altere esses termos continua pendente de fluxo próprio.

O dashboard apresenta oferta, orçamento/usos, duração, público, faixa de carrinho e margem. Regras e métricas adicionais ficam em detalhe expansível. Não há formulário para montar o teste nem botão que simule uma aprovação de incentivo ainda indisponível. Formatos desconhecidos ou valores inválidos não são apresentados como termos utilizáveis.

## Autoridade comercial e migração

O contrato declara `separate_incentive_review_required`, `execution: unavailable` e `budgetStatus: not_reserved`. A aprovação existente continua ativando somente a comunicação. O contrato executável dessa comunicação não recebe o estudo nem a recomendação financeira; a aprovação não cria cupom, desconto, orçamento ou reserva. As verificações da execução e do registro financeiro interno conferem a recomendação original quando ela está presente.

A migração aditiva `20260929060000_weekly_incentive_recommendation` acrescenta JSON opcional ao ciclo. Exige estudo presente e bloqueia reescrita, remoção e desvinculação do documento após captura. Não altera dados históricos nem ativa flags. Os arquivos em `migrations` e `deploy-migrations` têm SHA-256 `7F30F98FFD18681A482A0FCFAB04849A3F3D5A4405E619A3504DDF5F020E1B6A`.

## Evidências locais

Passaram 187 testes distintos: 32 novos de domínio, 43 de regressão dos contratos de estudo/orçamento/política, 68 cenários de revisão no PostgreSQL, cinco de execução e 39 da contabilidade financeira. O teste de revisão que exige o job e Redis reais foi excluído. Casos cobertos incluem tetos em centavos, limite de usos, política desabilitada, adulterações, seis capturas concorrentes, falha do modelo e nova tentativa, mudança de limites, revisão, aviso, isolamento de loja, documento histórico e aprovação de comunicação sem gasto. As verificações focadas repetidas não entram novamente na contagem.

TypeScript da API e do dashboard passou. O cliente Prisma foi gerado somente na pasta isolada. A migração foi aplicada aos bancos descartáveis `revenue_strategy_0924` e `revenue_release_0928`, ambos com 57 migrações; sua repetição no banco de release terminou sem pendências.

As jornadas de navegador passaram em 1440 e 390 px com respostas HTTP controladas: termos automáticos, mudança de limites, formato desconhecido, valores inválidos, ausência de sugestão, alternativa, recusa, aprovação de comunicação, idempotência, histórico, métricas e ausência de overflow. As capturas dos detalhes foram inspecionadas visualmente; uma altura maior foi usada apenas para capturar a seção inteira abaixo do cabeçalho fixo. Os testes de interação usam viewport de 900 px de altura.

Evidências em `.audit/revenue-weekly/incentive-recommendation-*` e `apps/api/.audit/revenue-weekly/incentive-recommendation-*-migrations.log`. Banco/API e navegador controlado são evidências separadas. Não houve chamada de modelo real, pagamento, provedor comercial, publicação ou implantação.

## Próxima etapa do fluxo comercial

A sugestão automática está implementada. Ainda faltam revisão/aprovação específica dos termos de incentivo, plano estatístico e atribuição próprios, aplicação transacional com revalidação de catálogo/público/margem/saldo, conciliação com evidência de pedido/pagamento e métricas dos resgates. Aprovar uma sugestão não pode ser apresentado como execução até esse caminho estar conectado. RI-12 (aprendizado validado entre lojas), RI-13 (demais canais), economia integral e piloto operacional continuam pendentes.
