# Planejamento automático da medição de incentivos

Entrega 43, em 29/09/2026. Complementa a [sugestão automática](revenue-intelligence-incentive-recommendation-2026-09-29.md) e o [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md).

## Comportamento

Novos ciclos capturam `weekly-incentive-recommendation-v2`. Além de oferta, público, margem e teto financeiro, o motor prepara `incentive-fixed-horizon-planning-v1`: métrica, denominador, amostra necessária, capacidade semanal e cobertura financeira. O lojista não escolhe o tamanho da amostra nem precisa calcular orçamento estatístico. Não há chamada adicional à LLM.

A leitura histórica ocorre uma vez, na mesma transação e no mesmo snapshot do estudo. A consulta mantém a primeira sessão madura por comprador na janela de 28 dias, consentimento válido, intenção anterior à sessão, carrinhos sem incentivo e catálogo da própria loja com custos conhecidos. O planejamento restringe esse conjunto à intenção e faixa de carrinho sugeridas, ao cohort `treatment` e à aprovação determinística do desconto limitado. Holdout e cohort desconhecido ficam fora. Um comprador com mais de um pedido aprovado conta uma única conversão; pedidos pendentes ou fora da janela de 168 horas não contam. Quem não comprou permanece no denominador. Identificadores individuais e itens não entram no documento publicado.

Os números são contagens inteiras capturadas, não reconstruções da taxa arredondada da simulação. A base representa o estado histórico registrado no momento da análise, com catálogo atual; não comprova exposição passada a uma oferta nem estima efeito causal. Selecionar a primeira sessão antes de qualificar a oferta é conservador: uma sessão posterior do mesmo comprador não substitui a primeira para aumentar a amostra.

O plano usa sete dias de entrada e mais 168 horas para maturação das últimas participações, alocação 50/50, conversão em pedido aprovado por comprador atribuído e leitura em horizonte fixo. Reutiliza a aproximação de duas proporções já utilizada nos experimentos, com confiança de 95% e poder de 80%. O efeito mínimo é fixado em **100 pontos-base absolutos, ou 1 ponto percentual**, por esta versão do contrato. É um parâmetro do motor, não previsão da LLM nem promessa de aumento nas vendas. A inferência registrada é Newcombe-Wilson bilateral; a coleta e a avaliação específicas dos incentivos ainda precisam ser conectadas.

Exige ao menos 100 compradores históricos e taxa utilizável para calcular a amostra. Histórico parcial, base pequena e taxa sem suporte são resultados distintos, sem número de amostra inventado. A leitura já existente recusa janelas com mais de 10 mil sessões ou registros de intenção; nesse caso o estudo não produz candidato. O contrato de planejamento também distingue uma base incompleta de uma base completa vazia.

A capacidade semanal por grupo é `floor(compradores / 28 × 7 / 2)`. É uma estimativa histórica, sem garantia de tráfego futuro. Se ficar abaixo da amostra, registra `insufficient_weekly_traffic`.

O financiamento precisa comportar o desconto máximo para **cada comprador atribuído ao tratamento**, sem depender da expectativa de poucas conversões. A cobertura é a quantidade de usos sugerida; orçamento necessário é `amostra por grupo × teto por compra`. Se insuficiente, registra `insufficient_budget`. Não aumenta limites, percentual, prazo ou orçamento do lojista. Quem não compra não gera gasto; esta conta é planejamento conservador, não reserva de dinheiro.

Exemplo de referência: 1.000 compradores e 100 conversões históricas exigem 14.751 compradores por grupo para o efeito fixado. O histórico estima apenas 125 por grupo em sete dias. Com 26 usos sugeridos, faltam tanto tráfego quanto cobertura. Uma semana continua sendo a cadência de análise; não é tratada como garantia de evidência conclusiva.

## Persistência, compatibilidade e dashboard

O planejamento está dentro da recomendação imutável do ciclo e do hash da proposta, capturados antes do modelo. Os mecanismos existentes de lease, `REPEATABLE READ`, publicação atômica e verificação do documento armazenado protegem também essa versão. Repetições e revisões conservam contagens, critérios e limites mesmo após novas vendas, devoluções ou alterações de catálogo e política. Uma base alternativa canônica continua sendo rejeitada se divergir da capturada no ciclo.

`v1` permanece reproduzível e legível sem backfill. Propostas sem estudo, sem candidato ou com política desligada não recebem planejamento fictício. A versão `v2` declara `samplePlanning: included_in_recommendation`; a aprovação e a execução permanecem indisponíveis para incentivos. Não foi necessária migração: os bancos locais continuam com as 57 migrações anteriores e o gatilho existente protege o JSON completo.

O dashboard apresenta “Condições para medir o teste”, motivos de insuficiência e contagens por grupo. Detalhes explicam efeito mínimo, cobertura conservadora, maturação e ausência de resultado medido. Formatos futuros, valores inválidos e contradições de capacidade exibem uma orientação para atualizar o dashboard. As propostas antigas preservam sua apresentação. Nenhum formulário de montagem ou botão de aprovação comercial foi adicionado.

## Evidências locais

Passaram **202 testes distintos**: 88 de domínio/leitura e regressão do cálculo estatístico, 70 cenários de revisão/publicação no PostgreSQL, cinco de execução e 39 da contabilidade financeira. Os 13 cenários focados de revisão repetidos estão incluídos nos 70, sem dupla contagem. O teste que exige o job e Redis reais foi excluído. Há cobertura de captura concorrente, falha do modelo e repetição, preservação em revisões, alteração de limites, base canônica diferente da persistida, compatibilidade com v1, contagens inteiras e holdout, pedidos duplicados/tardios/pendentes e ausência de gasto na aprovação de comunicação.

TypeScript da API e do dashboard passou. Nenhum cliente Prisma compartilhado foi regenerado. A consulta aos dois bancos locais confirmou as 57 migrações anteriores; não houve mudança de schema nesta entrega.

As jornadas de navegador passaram em 1440 e 390 px com respostas HTTP controladas. Cobrem capacidade insuficiente/suficiente estimada, histórico pequeno/incompleto, taxa inutilizável, formatos inválidos/futuros, planejamento ausente, recomendação antiga, política alterada e os percursos existentes de revisão, aprovação da comunicação e métricas. Capturas de desktop e celular foram inspecionadas visualmente. O viewport maior é usado somente para capturar a seção abaixo do cabeçalho fixo; as interações usam 900 px de altura.

Evidências em `.audit/revenue-weekly/incentive-planning-*`. Banco/API e navegador com HTTP controlado são verificações separadas, sem afirmação de E2E com provedor ou ambiente publicado.

## Escopo ainda pendente

Este é o planejamento persistido, não a ativação de incentivos. `estimated_feasible` indica somente capacidade estimada de amostra e financiamento; não autoriza gasto nem significa que o checkout está pronto. A futura revisão comercial deve exigir o plano válido, os limites vigentes e todos os demais requisitos de execução. A aprovação de comunicação continua independente e não reserva orçamento, cria cupom ou concede desconto.

Faltam aprovação/revisão específica de incentivo, atribuição própria, aplicação transacional com revalidação de público/catálogo/margem/saldo, conciliação com evidência de pedido/pagamento e métricas reais de resgates. Aprendizado validado entre lojas, demais canais, economia integral e piloto operacional continuam no plano. Nenhuma chamada a modelo ou provedor real, publicação ou implantação foi feita nesta entrega.
