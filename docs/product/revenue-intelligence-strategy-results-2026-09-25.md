# Revenue Intelligence — resultados por estratégia e versão

Vigésima entrega local no branch `feat/revenue-intelligence-weekly`. Conecta a medição à participação imutável do novo motor e apresenta os resultados no dashboard. Sem implantação, ativação pública, chamadas de IA ou efeitos em provedores reais.

## Medição

O caminho anterior usa `checkout_sessions.prompt_variant_id`. As estratégias versionadas usam `StrategyAssignment` e não preenchem esse campo; portanto a consulta antiga omitia seus participantes. A coleta agora seleciona o registro de participação da execução exata, preservando o adaptador antigo para experimentos anteriores.

A consulta começa por todos os participantes, incluindo quem não conversou ou comprou. Usa o horário imutável de entrada como origem da janela de conversão. Pedidos aprovados da mesma loja/sessão entram em `[entrada, fim da janela)` e até o horário da coleta. Sessões convertidas são deduplicadas; pedidos e receita são contados separadamente. Pedidos de outra loja, sessões legadas ou holdout não entram nesta população. Dados posteriores à janela ficam de fora.

Compras de sessões ainda pendentes ficam em indicadores provisórios separados. A conversão principal aguarda maturidade. O fim de sete dias sozinho não prova melhora: continuam valendo a amostra planejada, maturidade, diagnóstico de distribuição entre grupos e intervalo de confiança previamente definido.

Participação, pedidos, turnos, resultado do provedor, publicação e visibilidade informada são consultados em uma única instrução SQL. As contagens de entrega não substituem o denominador experimental. Exibição continua sendo uma declaração do cliente, sem comprovação de atenção humana. Interrupção precoce e inconsistências de contexto invalidam a inferência.

Cada coleta preserva evidência e resultado imutáveis. Repetir a chave retorna a coleta original; corrigir o estado de um pedido afeta apenas uma coleta posterior. A base é o estado registrado no momento da coleta, não uma reconstrução histórica completa de pagamentos e estornos. Receita de pedidos aprovados não representa recebimento líquido, receita incremental ou lucro. Contribuição e custo de IA continuam ausentes até existir cobertura verificável de seus componentes.

## Dashboard e API

`GET /revenue-manager/strategies/:id/metrics?version=N` consulta o último registro. `POST` na mesma rota aceita somente a versão e coleta com uma chave horária gerada pelo servidor. Autenticação, loja e capacidade `revenueManager` seguem as proteções da revisão. O cliente não pode fornecer horário, contagens, loja, execução ou chave que contorne a deduplicação. Repetições e concorrência geram no máximo uma nova coleta por execução/hora por essa rota, sem LLM.

A página coleta ao abrir e consulta novamente enquanto está visível, com intervalo de um minuto. Mostra a data efetiva dos dados e avisa que a medição é atualizada no máximo uma vez por hora. Apresenta participantes, sessões maduras, conversão, pedidos, receita observada em reais, mensagem salva e exibição informada por grupo. Estados de coleta, maturação, falta de conclusão, melhora, queda e inconsistência têm textos próprios.

Uma falha conserva a última medição datada com aviso. Trocar a versão desmonta o painel; uma proposta nova não herda os resultados da versão anterior. Versão sem execução informa que o teste não foi ativado. Esta coleta não aprova, expande, promove, pausa nem altera a estratégia. A coleta automática fora do dashboard e a decisão de continuidade ainda precisam ser integradas ao ciclo operacional.

## Validação local

- 12 testes completos de integração dos experimentos anteriores em PostgreSQL, 8 testes do plano estatístico e 1 de autorização/projeção da nova rota: 21 aprovados.
- 6 cenários PostgreSQL novos de estratégias: não compradores, pedidos duplicados por sessão, limites temporais, maturidade pendente, correções, concorrência, entrega, isolamento por loja/versão, horário imutável e pausa precoce. Todos aprovados na execução final.
- 13 testes de transporte e modelo do dashboard aprovados.
- Duas jornadas completas de navegador, em 1440/390 px com verificações adicionais em 720/320 px. Exercitam revisão/recusa/alternativa existentes, métricas, falha de atualização, estados positivo/inválido e isolamento por versão. Dashboard real com API HTTP controlada; não é evidência de venda real ou de jornada conectada à API real.
- TypeScript da API e dashboard aprovado; `git diff --check` aprovado. Nenhuma nova migration nesta entrega.

A primeira versão do teste de alteração de data tentou modificar um campo já protegido pelo banco. O fixture foi corrigido para exigir a rejeição e confirmar que nenhuma sessão amadurece com essa tentativa. A execução final passou. A verificação de navegador inicialmente falhou por resolução de `react-refresh` no servidor local e por compilação inicial. Foi usada configuração Vite isolada com carregamento nativo e maior prazo apenas de navegação; os cenários completos passaram após isso. Dependências compartilhadas não foram instaladas ou regeneradas.

Evidências locais: `.audit/revenue-weekly/strategy-metrics-{legacy-final,final,api-types,dashboard-types,browser-verified}.log` e screenshots em `strategy-metrics-ui`. Arquivos de auditoria não entram no commit.

## Continuação

RI-09/10 ainda precisam de paridade completa da execução do checkout, cobertura econômica, regras de parada, acompanhamento fora do dashboard e aprovação ligada à ativação. Incentivos e aprendizagem entre lojas dependem desses controles. Esta entrega não conclui o piloto nem comprova revenue lift comercial.
