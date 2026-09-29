# Revenue Intelligence — orçamento e consumo de IA por estratégia

Vigésima segunda entrega local no branch `feat/revenue-intelligence-weekly`. As chamadas do experimento passam pelo teto compartilhado com a análise semanal e seu consumo aparece na medição versionada. Sem implantação, ativação ou chamadas a provedores reais.

## Admissão e orçamento

Antes da chamada fixada ao provedor, `StrategyAiBudget` reserva o limite superior de custo usando uma tarifa explícita `revenue-upper-bound-v1`, na moeda configurada. Valida loja, execução, prompt, mensagem vinculada, tamanho da entrada e limite de saída. O limite de entrada usa bytes UTF-8 mais uma folga conservadora; não é uma medição por tokenizer.

O planejador e as conversas consultam a visão `revenue_ai_budget_reservations` sob o mesmo advisory lock. Compartilham limites diários/mensais, parcela reservada para revisão, RPM, TPM e concorrência. O experimento tem adicionalmente `REVENUE_STRATEGY_AI_EXECUTION_LIMIT_MICROS` e `REVENUE_STRATEGY_AI_SESSION_MAX_CALLS`, ambos obrigatórios. Ausência de configuração ou preço impede o envio. Chamadas incertas retêm a reserva mesmo depois da mudança de dia/mês.

A reserva congela tarifa, limites e hash da requisição. `AiUsageEvent` guarda o consumo, sem duplicar custo a cada retry. A tabela de reservas registra compromisso, não uma segunda despesa. Uma divergência acima dos limites bloqueia novas chamadas para conciliação. Esta entrega cobre as chamadas fixadas do experimento e as reservas do planejador, não todos os caminhos de IA existentes no produto.

## Resultado do provedor e falhas

O gateway aceita contadores inteiros, não negativos, coerentes e vinculados ao modelo fixado. O consumo pode ser válido mesmo quando o conteúdo da resposta é inutilizável. Não aceita preços enviados no corpo da resposta. Consumo ausente/inválido permanece desconhecido; não vira zero.

Quando este worker comprova que não invocou o gateway, a reserva é liberada com consumo zero. Isso também cobre uma reserva confirmada no banco cuja confirmação se perdeu no retorno. Depois de invocar o gateway, timeout/falha sem consumo verificável mantém o compromisso. Falha ao persistir o consumo não libera uma resposta ao comprador, e a admissão já registrada impede repetir o envio. Uso conciliado e tarifas congeladas são protegidos contra reescrita.

## Métricas e experiência do lojista

A medição inclui todas as chamadas dos participantes, mesmo sem compra ou mensagem publicada. Apresenta cobertura conhecida, valores incertos e estimativa pela tarifa limite, na moeda original. Moedas diferentes não são somadas. Consumo conciliado depois do horário de referência não altera uma medição anterior; uma nova coleta registra a informação atualizada.

O dashboard mostra a estimativa somente quando o grupo tem cobertura completa e moeda única. Explica que não é a fatura do provedor e que não inclui a análise semanal nem outras chamadas de IA. `aiCostCents`, contribuição e lucro permanecem indisponíveis enquanto não houver cobertura de todos os componentes. Não há decisão comercial automática baseada nessa estimativa parcial.

## Validação

- 162 cenários de regressão em PostgreSQL local: 160 passaram na rodada completa; dois doubles antigos não implementavam a nova interface de orçamento. Após correção dos doubles, ambos passaram na rodada direcionada, junto aos dez cenários de acompanhamento automático. Nenhuma falha conhecida permaneceu. A rodada completa não foi repetida após essa correção restrita aos testes.
- Nove testes do gateway passaram. A rodada anterior de 18 cenários de orçamento, métricas e custo também passou; eles se sobrepõem à regressão e não devem ser somados como cobertura distinta.
- TypeScript da API com cliente Prisma isolado e do dashboard passaram. Schema validado e sem diferença contra o banco de desenvolvimento descartável.
- Duas jornadas de navegador com API controlada passaram em 1440/390 px, incluindo 720/320 px, valor de 13 micros sem arredondamento para zero, cobertura parcial, falha de atualização e isolamento entre versões.
- Evidências locais em `.audit/revenue-weekly/strategy-ai-budget-regression.log`, `strategy-ai-gateway-final.log`, `strategy-monitor-final.log` e `strategy-monitor-browser.log`. Nenhum teste acionou provedor real ou comprovou retorno comercial.

## Ativação e continuação

A migration `20260925050000_strategy_ai_budget` cria reserva, visão compartilhada e proteções. Banco atualizado e cliente Prisma compatível são pré-requisitos das consultas de orçamento e métricas. O cliente usado nos ensaios é isolado em `.audit`; não foi regenerado o cliente compartilhado do workspace.

As flags de execução pública permanecem desabilitadas. Aprovação ligada à ativação, paridade funcional do checkout, incentivos e aprendizagem entre lojas continuam no plano. O acompanhamento/encerramento automático e a embalagem de migrations estão descritos nas entregas locais seguintes. Configuração de preços/tetos reais, publicação e piloto comercial não foram executados.
