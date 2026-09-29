# Orçamento vinculado à recomendação da IA

Entrega 44, em 29/09/2026. Complementa o [planejamento da medição](revenue-intelligence-incentive-planning-2026-09-29.md) e o [plano técnico](revenue-intelligence-implementation-plan-2026-09-24.md).

## Comportamento

O registro interno de financiamento agora exige os valores exatos da recomendação capturada pelo motor. `recommendedIncentiveBudgetTerms` recebe a proposta e a data de início; deriva orçamento total, teto por compra e quantidade máxima de usos. O futuro fluxo de aprovação não precisa solicitar esses valores ao lojista. Valores alternativos, mesmo menores e dentro dos limites da loja, são recusados: aceitar outro orçamento exige outra recomendação revisável.

O documento precisa ser `weekly-incentive-recommendation-v2`, ter status `recommended`, ser canônico e conter planejamento `estimated_feasible`. Limites financeiros devem corresponder à versão vigente. A análise precisa estar concluída, a loja inscrita no ciclo semanal e a proposta continuar atual e pendente de revisão. Histórico incompleto, tráfego ou cobertura insuficientes não podem ser contornados aumentando o orçamento enviado ao registro. Não há aumento automático dos limites nem chamada à LLM.

Exemplo: uma política com orçamento de R$ 10.005,00 e teto de R$ 10,00 por compra pode produzir uma sugestão de 1.000 usos e R$ 10.000,00. O financiamento conserva esse envelope; os R$ 5,00 restantes não são acrescentados silenciosamente.

O construtor anterior continua disponível para interpretar e validar termos históricos. Ele não basta para abrir financiamento: o registro e novas reservas passam pelo vínculo obrigatório à recomendação v2. Propostas antigas permanecem legíveis, sem backfill ou autorização retroativa.

## Persistência e concorrência

A migração `20260929070000_incentive_recommended_funding`, espelhada em `prisma/migrations` e `prisma/deploy-migrations`, acrescenta um gatilho antes da criação de orçamentos e reservas. Ele exige correspondência entre a recomendação publicada e o documento imutável do ciclo, os três limites financeiros, política vinculada, identidade da loja/análise, versão e estado da estratégia. Confere planejamento sem bloqueios, amostra, cobertura e multiplicação do teto por quantidade usando aritmética sem overflow de inteiro.

O bloqueio segue a ordem existente: loja, cabeça da política financeira, estratégia, demais registros financeiros. A linha mutável da estratégia é bloqueada também na aplicação; uma transação com snapshot anterior à substituição da proposta falha em vez de reservar com a versão antiga. Os cenários exercitam `READ COMMITTED` e `REPEATABLE READ`.

Os gatilhos novos atuam apenas em inserções. Não reescrevem orçamentos antigos nem impedem encerramento, consumo ou liberação de reservas existentes. Repetir exatamente uma solicitação já aceita devolve seu recibo histórico, inclusive após alteração de política ou proposta, sem criar nova reserva. A evidência financeira continua imutável e uma operação inteira reverte se a transação externa falhar.

## Validação local

Passaram **222 testes distintos**: 100 de domínio, 47 cenários financeiros no PostgreSQL, 70 de revisão/publicação e cinco de execução de comunicação. O reteste dos quatro cenários de alteração da política está incluído nos 47. O cenário que exige o job com Redis real foi excluído.

Há cobertura de valores divergentes abaixo dos tetos, recomendação ausente/antiga/bloqueada, análise ainda não concluída, gravações diretas no banco, proposta substituída durante uma transação, concorrência de reservas, isolamento por loja, repetição de solicitações, conciliação e aprovação de comunicação sem gasto comercial. As fixtures financeiras usam planejamento viável; os testes de esgotamento preenchem o orçamento por reservas reais, sem modificar contadores diretamente ou desabilitar gatilhos.

TypeScript da API passou. A migração foi aplicada nos dois bancos locais descartáveis, que passaram a 58 migrações. As duas cópias têm SHA-256 `7adcfae580511a35a55c819646f0bcbe763f97485e972163d0b02ba7efd8327c`. Não houve alteração do schema Prisma nem regeneração do cliente compartilhado.

Logs em `.audit/revenue-weekly/recommended-funding-*`. Esta entrega não altera o dashboard; não houve nova validação de navegador, chamada a modelo/provedor real ou implantação.

## Trabalho ainda necessário

O registro continua uma primitiva interna de contabilidade, com escopo `funding_only`. Não existe novo botão de aprovação, endpoint comercial ou desconto executado por esta entrega. `estimated_feasible` é condição de financiamento, não prova de efeito ou prontidão do checkout. A aprovação atual de comunicação continua independente.

Faltam conectar a decisão específica do lojista à execução de incentivos, atribuição dos compradores, aplicação transacional com revalidação de público/carrinho/catálogo/margem/empilhamento/saldo, conciliação com evidência real de pedido/pagamento e métricas de resgates. Aprendizado validado entre lojas, demais canais, economia integral e piloto operacional permanecem no plano.
