# Revenue Intelligence — acompanhamento e encerramento de testes

Vigésima quarta entrega local, sem ativação pública. O acompanhamento de resultados passa a funcionar sem o lojista manter o dashboard aberto. Não usa LLM: a análise de novas recomendações continua semanal por loja; ler métricas e encerrar o prazo não consomem chamadas de IA.

## Comportamento

`StrategyMonitorJob` consulta a cada 15 minutos uma fila BullMQ com lote configurável de até 500 execuções, padrão 100. O monitor usa a mesma chave horária do dashboard. Retries e workers concorrentes preservam uma única medição por chave. Resultados encerrados com evidência final e aviso persistido saem da coleta periódica.

No prazo de encerramento, a execução deixa de admitir novos participantes/turnos e recebe um evento auditável de parada. O monitor continua coletando até o fim da janela de conversão prevista, incluindo quem entrou perto do prazo. A data de uma pausa anterior do lojista é preservada; ela invalida a inferência de um teste interrompido antes do horizonte fixado. Resultados ainda incompletos não são promovidos.

Evidência inválida ou consumo da chamada acima do limite reservado encerram o teste antes do prazo. A coleta anterior é preservada e outra registra a parada, com chave distinta e timestamp posterior. Não há encerramento antecipado por observar um resultado comercial positivo/negativo, extensão automática do teste ou adoção automática de uma variante.

O dashboard recebe aviso deduplicado por execução e estado final: melhora, queda, inconclusivo ou inválido. O aviso aponta para a estratégia e guarda versão/medição. Se a gravação do aviso falhar depois da medição, o próximo poll repete a gravação sem criar outro resultado ou duplicar o aviso. A interface distingue encerramento no prazo de interrupção antecipada.

## Configuração e validação

- `REVENUE_STRATEGY_MONITOR_ENABLED=false` por padrão. `REVENUE_STRATEGY_MONITOR_BATCH_LIMIT=100`. A fila exige Redis configurado; desativar novas recomendações não desativa um monitor já habilitado.
- Oito cenários PostgreSQL passaram: configuração, dashboard/workers concorrentes, horizonte/maturidade, retry de notificação final, evidência inválida, estouro de custo, lote entre lojas e preservação da pausa do lojista.
- Dois cenários de job passaram, incluindo duas instâncias reais em Redis local com apenas um agendamento repetitivo. O banco e a fila são descartáveis e explicitamente permitidos pelo teste.
- TypeScript API/dashboard e duas jornadas de navegador com API controlada passaram, incluindo mensagens de encerramento/interrupção, custo parcial de IA e isolamento de versão.
- Logs: `.audit/revenue-weekly/strategy-monitor-final.log`, `strategy-monitor-api-types-final.log`, `strategy-monitor-dashboard-types.log`, `strategy-monitor-browser.log`.

O primeiro ensaio encontrou notificações residuais entre fixtures; a limpeza passou a incluir `merchant_notifications` e todos os dez cenários passaram novamente. A coleta para depois do prazo de maturidade; uma correção posterior de pedido ainda exige nova coleta explícita no dashboard. O monitor não substitui os guardas de admissão/publicação nem prova operação em produção.

## Continuação

Aprovação pública/ativação e paridade de todas as rotas de checkout continuam bloqueadas. Encerrar o registro da execução não resolve por si só a transição das sessões antigas para fora do experimento. Custos completos, incentivos protegidos por margem, aprendizado entre lojas, outros canais e o piloto comercial continuam pendentes. Nenhuma chamada de IA real foi feita nesta validação.
