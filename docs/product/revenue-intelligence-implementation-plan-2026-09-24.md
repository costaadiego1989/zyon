**Plano técnico de implementação — inteligência de receita do Zyon/AACP**

Data: 24/09/2026. Complementa o [diagnóstico e roadmap](revenue-intelligence-roadmap-2026-09-24.md). Este documento especifica entregas; não representa código implementado, migração aplicada ou funcionalidade liberada.

**Resultado esperado.** Cada loja elegível recebe uma análise estratégica por intervalo de sete dias. A plataforma distribui o processamento pelas madrugadas, respeita orçamento e capacidade e apresenta recomendações no dashboard. A IA prepara e revisa a estratégia; o lojista aprova a versão; o backend protege as condições comerciais; o experimento mede o resultado. Aprendizados entre lojas entram como hipóteses para novos testes locais.

O primeiro piloto fecha esse ciclo com uma estratégia de comunicação no checkout e um experimento por loja. Cupons, descontos, frete subsidiado e contatos externos entram após os respectivos critérios econômicos e operacionais. A arquitetura e a medição desses recursos são preparadas desde o início.

**Ponto de partida verificado para decompor o trabalho.** O checkout local consultado está em `e82acb4`; a referência local `origin/master`, consultada novamente nesta continuação, aponta para `778263f`. Essa leitura não prova qual versão está em produção. Existem alterações anteriores no workspace que devem ser preservadas. A implementação deve usar um checkout isolado e reconciliar somente dependências necessárias.

O módulo `apps/api/src/modules/ai-usage` e os modelos `AiUsageEvent` / `AiPriceVersion` existem no trabalho local, mas o diretório do módulo não está rastreado nesse checkout e não apareceu na árvore da referência `origin/master` consultada. Portanto, seu aproveitamento exige integrar e validar essa dependência explicitamente; não pressupor sua disponibilidade na base de implementação ou na produção. O contrato local já contempla custo em micros, moeda, versão de preço, status de execução e reconciliação. A reserva prévia de orçamento do planejador deve complementar esse registro, evitando dois totais financeiros concorrentes.

O controlador atual exige a capacidade `revenueManager` do plano comercial. “Todas as lojas” significa cobertura de todas as lojas elegíveis ao recurso, preservando isolamento e permissões. O agendador deverá aplicar a mesma elegibilidade. Ampliar o recurso para outros planos é uma decisão comercial separada.

**Contratos que precisam orientar o código desde a primeira entrega.**

| Contrato | Decisão de implementação |
| --- | --- |
| Cadência | Intervalo mínimo de sete dias desde a conclusão do último ciclo bem-sucedido; virada de semana, versão do modelo e botão manual não criam exceção |
| Distribuição | Sete grupos preferenciais persistidos, balanceados; processamento na janela noturna local; lojas atrasadas mantêm prioridade e não recebem ciclos retroativos em sequência |
| Repetição | Um `AnalysisRun` por loja/ciclo; retry retoma a etapa e os artefatos existentes; uma lease vencida não autoriza dois workers a publicar |
| Custo de IA | Reservar antes de cada chamada, incluindo fallback e revisão; conciliar com o uso; falha de contabilização ou preço desconhecido impede novas chamadas pagas |
| Aprovação | Vinculada à versão imutável e às condições apresentadas; revisão, expansão e mudança material exigem nova aprovação |
| Autorização comercial | Configuração da loja e motor determinístico prevalecem; a LLM não concede descontos nem altera margem por texto |
| Experimento | Baseline real, controle preservado, identidade estável e métrica definida antes do teste; não declarar sucesso só por completar sete dias |
| Resultado | Receita associada, efeito incremental, contribuição e custo de IA aparecem com definições próprias; dado ausente não vira zero nem lucro comprovado |
| Aprendizado | Recusa registra preferência; resultado de experimento registra evidência; biblioteca compartilhada usa projeção autorizada e agregada |

**Contrato de medição da primeira entrega.** Evoluir `ObservationSnapshot` com `metric_definition_version`, `as_of`, limites da coorte, janela de conversão, contagens maduras/pendentes e origem dos custos. Manter um adaptador para consumidores antigos; não reinterpretar snapshots históricos como se já obedecessem à nova definição.

1. Selecionar sessões da própria loja que iniciaram em `[window_start, window_end)`. O intervalo semiaberto evita contar a mesma sessão em dois períodos contíguos. O snapshot semanal pode ter sete dias de entrada de sessões e resultados ainda pendentes.
2. Vincular pedido pago à sessão elegível, respeitando a janela de conversão definida. Contar cada sessão convertida uma vez na taxa; registrar pedidos e receita separadamente. Pedido de sessão anterior não entra no numerador dessa coorte.
3. Calcular conversão madura usando apenas sessões cujo período de conversão encerrou; mostrar separadamente coorte total, pendentes e sinais provisórios. Nos experimentos, manter a análise principal por todos os atribuídos da população definida, incluindo não compradores e falhas de exposição, e respeitar a maturidade exigida antes da conclusão.
4. Deduplicar etapas do funil por sessão. Objeção de frete e falha de pagamento são sinais; uma sessão que depois pagou não é abandono. Classificar abandono conforme expiração/janela encerrada, com motivo desconhecido quando não houver evidência. Não inferir preço ou desconfiança apenas pela ausência de compra.
5. Determinar comprador recorrente usando compras anteriores à entrada na coorte. Não usar compras posteriores para reclassificar retroativamente seu contexto inicial.
6. Versionar a política de contribuição e registrar componentes monetários: receita paga líquida de estornos, mercadoria, pagamento, tributos configurados, frete subsidiado, comissão, comunicação e IA pertinentes. Total já líquido de cupom não recebe uma segunda dedução do mesmo cupom. Valores ausentes permanecem ausentes com cobertura explícita.
7. Reprocessar com a mesma definição e evidências deve reproduzir o resultado. Pagamentos e estornos tardios geram atualização identificável; preservar o snapshot usado na decisão original.

**Modelo de execução e consistência.** Nomes abaixo são propostos, sujeitos às convenções finais do projeto.

| Registro | Campos/restrições essenciais |
| --- | --- |
| `MerchantAnalysisSchedule` | Loja única, elegibilidade, fuso IANA, grupo/dia preferencial, próximo vencimento, último ciclo concluído, versão para concorrência |
| `AnalysisRun` | Loja/ciclo únicos; janela congelada, versão do planejador, etapa, resultado, tentativas, lease/fencing token, snapshot e timestamps |
| `AnalysisStep` ou checkpoints equivalentes | Artefato reutilizável por etapa e idempotência; resposta já recebida e persistida não é regenerada no retry |
| Registro existente de consumo de IA | Um evento por chamada/tentativa, fonte `revenue_manager`, correlação com ciclo/revisão, provedor, modelo, tokens, custo, moeda e preço versionado |
| `AiBudgetPeriod` / `AiBudgetReservation` | Escopo, período, limite, gasto, saldo comprometido; chave idempotente por tentativa; relação com evento de uso e estado de conciliação |
| Estratégia e versão | Identidade estável, versão imutável, diagnóstico, ações, público, limites, teste, prazo, hash da proposta, snapshot/política utilizados |
| Revisão/execução | Ator derivado da autenticação, versão exata, decisão, ação idempotente, efeitos e falhas reconciliáveis |
| Atribuição/exposição/resultado | Loja, estratégia, versão, experimento, unidade, braço, momento e proveniência; preservar atribuição mesmo sem exposição ou compra |

Separar estado operacional do ciclo (`queued`, `running`, `deferred_budget`, `retry_wait`, `completed`, `failed`) de seu resultado (`recommendations`, `keep_current`, `insufficient_data`, `no_material_change`). Uma inspeção concluída sem LLM também encerra o ciclo semanal. Falha não avança `last_successful_analysis_at`; mantém cooldown, limite de tentativas e sinalização de atraso. A próxima execução bem-sucedida agenda vencimento nunca anterior a sete dias da conclusão e respeita a próxima janela noturna disponível.

Enfileirar por loja a partir de paginação estável, com claim transacional e restrição única no banco. A fila entrega pelo menos uma vez; o efeito é deduplicado no banco. Leases usam token crescente para rejeitar gravações de worker antigo após retomada. Um processo de reconciliação recupera ciclos gravados antes de uma falha de enqueue. A janela de dados é congelada no primeiro processamento válido, não no horário em que o job ficou dias aguardando orçamento.

Estado + artefato + evento outbox/notificação são persistidos atomicamente quando pertencem ao mesmo efeito. Chamadas a LLM ou provedores ficam fora da transação. Reinício não apaga quotas, agenda nem aprovação. Ausência de Redis não habilita uma rotina paralela sem coordenação: o planejador pago fica indisponível e o motivo aparece no estado operacional.

O agendador consulta periodicamente vencimentos para atender fusos diferentes; a análise de cada loja continua semanal. Se a capacidade não cobrir todas as lojas em sete dias, mostrar atraso e déficit. A distribuição diária não deve abandonar lojas de pouco tráfego; novas lojas recebem capacidade reservada configurável, enquanto o envelhecimento da fila impede starvation.

Persistir um resumo e uma notificação por ciclo, inclusive quando a conclusão for manter a estratégia, aguardar dados ou informar falha. Agrupar retries e andamento no mesmo aviso para não criar uma notificação por tentativa técnica. Proposta nova, revisão pronta, pausa de proteção e resultado merecem eventos próprios, deduplicados por ciclo/versão/tipo. O dashboard sempre permite abrir o histórico da tentativa de melhoria, com horário, motivo e próximo passo.

**Admissão de custo, por chamada.** Primeiro gerar contexto agregado e aplicar limites de entrada/saída. Calcular uma reserva máxima com tarifa versionada e unidades cobradas pelo provedor; preço ou limites não conhecidos bloqueiam a chamada. O limite em quantidade de análises complementa o limite financeiro.

1. Em transação curta, reservar nos escopos global diário/mensal, loja/ciclo e categoria de trabalho, em ordem consistente de locks. Validar `gasto contabilizado + reservas abertas + nova reserva <= limite` em cada escopo.
2. Separar a parcela para revisões interativas dentro do teto total. Análises agendadas não consomem a parcela protegida; revisão continua sujeita aos limites globais e da loja. O job da biblioteca compartilhada também consome orçamento contabilizado.
3. Obter capacidade de requisições/tokens e concorrência por provedor/modelo. Voltar à fila sem chamar o provedor quando não houver capacidade; não segurar transações durante espera.
4. Registrar que a tentativa foi despachada e chamar o provedor. Confirmar o consumo e liberar somente a sobra comprovada. Falha conhecida antes do envio pode liberar toda a reserva.
5. Timeout ou resultado incerto preservam o compromisso financeiro e o estado de reconciliação. Não liberar por TTL como se a tentativa fosse gratuita. Retry/fallback requerem outra reserva e respeitam o limite de tentativas.
6. Conciliar sem contar duas vezes o evento já reservado. Divergência acima do máximo estimado gera alerta, correção do ledger e bloqueio de novas chamadas afetadas; a garantia do teto depende de um limite superior correto para o pedido enviado.

Moedas diferentes não são somadas diretamente. Guardar custo e moeda originais e, se necessário, conversão com cotação/versionamento para a moeda de orçamento. Micros evitam arredondar cada chamada pequena para zero. Reservas pertencem a períodos identificáveis; mudança de dia/mês não apaga chamadas em voo ou passivos incertos. Cobrar o mesmo efeito uma única vez e reconciliar correções contra o período de origem.

| Configuração proposta | Valor ou regra inicial |
| --- | --- |
| `analysis_interval_days` | 7; sem override pelo botão manual |
| `default_timezone` | `America/Sao_Paulo`; fuso IANA por loja |
| `analysis_window_start` | 03h local como referência; janela e dispersão configuráveis |
| `max_new_proposals_per_cycle` | 3; zero é um resultado válido |
| `max_active_experiments_per_store` | 1 no piloto |
| Limites diários/mensais de dinheiro | Obrigatórios antes de habilitar chamadas; medir custo p50/p95 para definir valores |
| Limites por chamada/ciclo/revisão | Obrigatórios; entrada, saída e tentativas explicitamente limitadas |
| Cota de revisões e novas lojas | Configurável dentro dos tetos; percentual ainda não fixado |
| RPM/TPM e concorrência | Configurados para o provedor/modelo efetivamente usados |
| Janela de conversão, duração máxima e amostra | Versionadas por experimento; simular capacidade com tráfego conhecido antes de ativar |
| Participação e suporte mínimo entre lojas | Obrigatórios antes de habilitar biblioteca compartilhada |

Nenhum valor financeiro de exemplo neste plano autoriza gasto externo. Ausência de configuração obrigatória permite inspeção determinística e indica indisponibilidade de geração paga.

**Backlog em entregas revisáveis.** Cada linha é um pacote de mudança; pode ser dividido em PRs menores. Responsáveis são papéis sugeridos, sem atribuição a pessoas ou criação de tickets externos.

| ID / ordem | Entrega e arquivos principais | Dependências | Aceite verificável |
| --- | --- | --- | --- |
| RI-01 | Coortes, funil e qualidade de dados em `observe-metrics.use-case.ts` e `observation.entity.ts`; contrato versionado | Nenhuma | Sessões de períodos diferentes não se misturam; evento repetido não infla taxa; falha seguida de pagamento não é abandono; pendentes não viram perda definitiva |
| RI-02 | Contrato de custos/contribuição no Revenue Lift e autorização comum em `rules-engine`, `coupons` e fluxos de frete | RI-01 para métricas | Custo ausente bloqueia incentivo; taxas e desconto não duplicam; mudança de preço/estoque/política é revalidada; casos no limite conciliam em centavos |
| RI-03 | Inferência e encerramento em `experiments`; plano estatístico prévio e gate de promoção | RI-01 | Testes negativos/inconclusivos/inválidos não viram vencedores; amostra/duração/maturidade são exigidas; seleção automática não publica nova estratégia sem aprovação |
| RI-04 | Agenda, ciclo e fila por loja; substituir orquestração de `daily-observation.job.ts`, com modo de observação e migração aditiva | RI-01 | Paginação cobre mais de 100 lojas; dois workers e restart não duplicam ciclo; sete dias mínimos; janela/fuso preservados; backlog visível |
| RI-05 | Integrar dependência de `ai-usage`, reservas financeiras duráveis, limites e admissão no `hypothesis-generator.adapter.ts` | RI-04 e reconciliação da dependência local | Chamadas concorrentes, revisões, fallback e timeout respeitam reservas; tentativa sem preço/capacidade não chama LLM; virada de período não zera compromisso |
| RI-06 | Planejador estruturado com evidências, até três propostas, opção de manter estratégia e avaliação offline em português | RI-01, RI-04, RI-05 | Saída inválida/oferta inventada bloqueada; fatos têm origem; preferência não modifica política; dados insuficientes evitam chamada inútil |
| RI-07 | Estratégias versionadas, revisão em linguagem natural e aprovação transacional; compatibilidade dos endpoints de hipóteses | RI-06 | Aprovar versão antiga retorna conflito; aprovar/revisar concorrentes têm resultado único; retry não duplica aprovação ou execução; recusa não ativa nada |
| RI-08 | Dashboard, notificação e detalhes de estratégia; reutilizar `RevenueManagerPage` e `StrategyReviewModal` | RI-04, RI-07 | Link direto/reload e mobile; ver diagnóstico, pedir alternativa, aprovar/recusar; leitura não encerra pendência; aprovado não aparece como ativo antes da ativação |
| RI-09 | Executar comunicação no checkout com outbox, publicação versionada, controle/exposição e pausa | RI-02, RI-03, RI-07, RI-08 | Compra completa mantém atribuição até pedido pago; controle usa baseline; exposição só usa versão aprovada; pausa impede novas exposições; falha de ativação é recuperável |
| RI-10 | Métricas por estratégia, relatório da primeira semana, memória privada e recomendação de continuidade | RI-09 | Resultado positivo, negativo, inconclusivo e inválido percorrem o fluxo; sete dias insuficientes não forçam decisão; adoção/expansão requer aprovação; rollback altera execução real |
| RI-11 | Cupom/desconto condicionado, simulação, orçamento comercial e concorrência; depois frete subsidiado | RI-02 e piloto RI-10 aceito | Resgates simultâneos não ultrapassam orçamento/limites; custo e carrinho revalidados; combinação de benefícios segura; cupom ligado à estratégia e público |
| RI-12 | Biblioteca compartilhada: projeção, evidência, contexto, recuperação e teste local | RI-10, participação e suporte independentes válidos | Isolamento e supressão de grupos pequenos; negativos preservados; contexto incompatível rejeitado; padrão novo não altera teste ativo; evidência em lojas separadas |
| RI-13 | Recuperação, recompra e outros canais; avaliação de personalização incremental | RI-10; RI-11 quando houver incentivo | Consentimento/frequência e supressão após compra; tentativa/aceitação/entrega distintas; controle respeitado em cada canal; modelo supera baseline no critério predefinido |

Backend e dados lideram RI-01 a RI-07; frontend participa do contrato de leitura a partir de RI-04 e entrega RI-08; QA participa dos cenários desde RI-01 e conduz as jornadas integradas. RI-04/05 podem avançar com contratos estáveis enquanto RI-02/03 são concluídos, mas ações do piloto só entram após seus gates.

**Primeiro lote de implementação.** Priorizar RI-01, RI-04 e RI-05, com o contrato econômico/estatístico de RI-02/03 definido desde o começo. Esse lote entrega medição coerente, agenda semanal e geração com orçamento protegido, atrás de flags e sem liberar novos tipos de ação. Evidência esperada: relatório determinístico reproduzível, ciclo retomável e reserva concorrente em PostgreSQL/Redis de teste. A mudança de cadência só pode ser ativada junto com os controles de custo e a retirada do caminho diário anterior para as lojas migradas.

**Contratos de API para permitir desenvolvimento coordenado.** Rotas e comportamentos abaixo são propostas relativas ao prefixo existente `/revenue-manager`; o `POST /trigger` já existe e terá seu contrato ampliado. Preservar os endpoints de hipóteses por adaptação, mantendo ID/link antigos. A permissão e a loja são derivadas da identidade autenticada em todas as leituras e escritas.

| Operação | Contrato proposto |
| --- | --- |
| `GET /analysis-status` | Último ciclo, próximo vencimento, previsão se disponível, estado da fila, motivo de adiamento e resumo; não expor orçamento global ou dados de outras lojas |
| `POST /trigger` existente | Reutilizar ciclo corrente ou enfileirar quando elegível; retornar estado e `next_eligible_at` se ainda não devido; deduplicar a requisição |
| `GET /strategies` e `GET /strategies/:id` | Estado, versão atual/aprovada, diagnóstico, evidência, ações, limites, teste, histórico e motivo de bloqueio |
| `POST /strategies/:id/revisions` | `base_version`, preferência e chave idempotente; retornar revisão assíncrona; usar snapshot do ciclo e orçamento de revisão |
| `POST /strategies/:id/approve` | Versão e chave idempotente; validar hash/política/validade no servidor; registrar aprovação e ativação pendente, sem afirmar execução concluída |
| `POST /strategies/:id/reject` | Versão, motivo opcional e idempotência; não acionar campanha |
| `POST /strategies/:id/pause` | Pausar versão ativa com trilha de auditoria e bloquear novas exposições |
| `GET /strategies/:id/metrics` | Definição, período, população, receita, contribuição, custo, intervalos, maturidade e qualidade; valores indisponíveis explicitados |

Usar `202` para trabalhos assíncronos aceitos, `409` para conflito de versão e respostas de indisponibilidade/adiamento com código estável e mensagem útil. Em reenvio da mesma chave, retornar o mesmo recurso; chave com conteúdo diferente é conflito. Se uma aprovação ganhar a corrida com pedido de revisão, a nova proposta não modifica a versão já aprovada; sua ativação fica condicionada a nova decisão e aos conflitos de experimento.

O cliente não define `merchant_id`, ator da aprovação, saldo disponível, resultado de margem ou métricas calculadas. Ver detalhes não consome LLM. Atualizar métricas não consome LLM. Apenas gerar/revisar/sintetizar dentro dos limites pode chamar o modelo.

**Critérios de teste antes de cada ampliação.** Os 55 testes executados no diagnóstico anterior continuam sendo apenas a evidência local daquele diagnóstico. Os cenários abaixo ainda precisam ser implementados/executados conforme cada entrega.

| Conjunto | Cenários de aceite |
| --- | --- |
| Coortes e dinheiro | Compra tardia, sessão anterior, eventos duplicados, pagamento recusado depois aprovado, estorno parcial, custo ausente, moeda diferente, cupom no total líquido |
| Agenda em banco/fila reais | 700 lojas sintéticas; atravessar sete dias com relógio controlado; restart; dois agendadores; worker antigo; criação de loja durante paginação; alteração de fuso; loja sem acesso ao recurso |
| Orçamento em banco real | Dezenas de reservas simultâneas contra saldo pequeno; retry/fallback; timeout após envio; resposta persistida antes de falha; conciliação duplicada; virada de dia/mês; preço indisponível |
| Isolamento e decisões | Acesso por ID de outra loja, ator adulterado, revisão versus aprovação, política alterada entre detalhe e clique, versão expirada e link legado |
| LLM | Fixtures em português para dados escassos, comentário hostil, catálogo com instrução maliciosa, promessa não suportada, pedido de desconto proibido e resposta malformada |
| Jornada no navegador | Aviso → detalhe → alternativa → nova versão → aprovação → ativação → métricas; recusa, pausa, falha recuperável, teclado, celular e recarregamento |
| Experimento | Não compradores no denominador, atribuição estável, holdout, prazo desde ativação, resultados positivos/negativos/inconclusivos, coleta tardia após encerrar exposições |
| Compartilhamento | Loja sem participação, grupo pequeno, contexto incompatível, efeito dominado por uma loja, padrão vencido, evidência negativa e versão congelada |

O cenário de 700 lojas usa dados artificiais e provedor controlado para testar escala, equidade e orçamento; não precisa fazer 700 chamadas pagas. Testes de LLM real, banco/filas reais, navegador e resultado comercial são evidências separadas. Uma bateria de testes de domínio não substitui o piloto de sete dias ou mais.

**Liberação e reversão.** Migrações aditivas primeiro, flags desativadas e leitura compatível. Backfill preserva versões, notificações e experimentos existentes. Inspeção em modo de observação calcula agenda e estimativas sem chamadas pagas ou efeitos. Depois, piloto limitado por loja, orçamento e ação.

Para cada loja migrada, desabilitar a geração antiga antes de habilitar a nova e garantir um único proprietário do ciclo. Jobs antigos que chegarem depois devem reconhecer a migração e terminar sem gerar. Não basta registrar outro cron mantendo o anterior ativo. O modo novo também deve impedir que promoção automática legada publique ou amplie estratégias fora do contrato de aprovação.

Reversão suspende novas análises/ativações e novas exposições afetadas; preserva registros financeiros, atribuições e coleta de resultados pendentes. Voltar a uma versão de código não pode reativar a rotina diária antiga nem esquecer reservas abertas. Definir flags independentes para geração, execução monetária, comunicação externa e uso de padrões compartilhados.

O piloto passa por três estados de aceite: controles técnicos comprovados; jornada completa comprovada; resultado comercial observado com maturidade. Resultado comercial inconclusivo não invalida uma integração correta, mas também não autoriza divulgar ganho ou expandir automaticamente. Publicação e migrações em produção são uma etapa própria, com evidências e autorização correspondentes.

**Decisões restantes para ativação, sem bloquear desenvolvimento local.** Definir tetos monetários e moeda, limites de tokens/tentativas, parcela de revisão, janela noturna final, lojas piloto, janela de conversão e duração máxima por teste. Antes da biblioteca compartilhada, definir participação, projeção permitida, suporte mínimo independente e critérios de validade. Os controles serão implementados para exigir esses valores; a LLM não os escolhe.

**Evidências de conclusão a anexar por entrega.** Commit e escopo, migrações previstas/aplicadas, testes e ambiente, jornada demonstrada, custo observado e limitações. Relatórios devem distinguir código local, validação controlada, provedor, implantação e resultado do cliente. O objetivo de produto é contribuição incremental com limites respeitados; número de propostas e taxa de aprovação são indicadores de uso.

**Implementação local registrada.** [Primeira entrega: coortes, agenda semanal e orçamento](revenue-intelligence-first-delivery-2026-09-24.md); [segunda entrega: proteção econômica](revenue-intelligence-economic-guards-2026-09-24.md); [terceira entrega: plano prévio e medição de experimentos](revenue-intelligence-measurement-2026-09-24.md); [quarta entrega: versões e revisão assíncrona](revenue-intelligence-strategy-versions-2026-09-24.md). A terceira entrega concluiu o ensaio local da migration de fundação semanal. A quarta avança versões imutáveis, recusa e pedidos de alternativa com orçamento do ciclo; aprovação/ativação continuam condicionadas ao baseline fiel e ao plano de medição apresentados ao cliente. Os relatórios distinguem código e testes locais da experiência completa ainda pendente. Nenhuma dessas entregas foi implantada nesta implementação.

[Quinta entrega: contrato do chat do checkout](revenue-intelligence-checkout-baseline-2026-09-24.md). O adaptador real passa a capturar o programa de mensagens, ferramentas e configuração do provedor para os turnos principais de LLM, condicionado a configuração explícita. Geração e revisão congelam esse artefato e recusam mudanças no contexto. Isso remove a indisponibilidade absoluta do baseline de chat; não fecha o controle do checkout completo nem libera aprovação/ativação. Plano revisável de medição, execução, exposição e dashboard continuam como próximos passos.

[Sexta entrega: medição vinculada à proposta](revenue-intelligence-proposal-measurement-2026-09-24.md). Captura antes da LLM um contexto histórico imutável por ciclo e inclui na proposta o público, as variantes, a duração, a janela de conversão e a amostra planejada. Alternativas preservam esses critérios; dados insuficientes encerram o ciclo sem chamada ao modelo. A leitura já apresenta o plano e seus limites. Dashboard, aprovação/publicação transacional, atribuição/exposição e execução permanecem pendentes.

[Sétima entrega: revisão no dashboard](revenue-intelligence-dashboard-review-2026-09-24.md). Conecta avisos e sugestões à página de estratégia com link direto, diagnóstico, limites, plano de teste, versões, recusa e pedido de alternativa. Preserva o texto durante atualizações e vincula decisões à versão/hash com retry idempotente. Validação local de interface, API e PostgreSQL/Redis. RI-08 continua parcial: aprovação/ativação aguardam a execução versionada e o registro durável de participantes e exposições de RI-09. Sem implantação.

[Oitava entrega: participação e admissão por estratégia](revenue-intelligence-execution-ledger-2026-09-24.md). Implementa o registro interno do contrato aprovado/plano revisado, participação atômica na primeira criação de sessão, atribuição estável, admissão única de turno e resultados separados do provedor. Protege identidade, loja, prazo e pausa em banco real. RI-09 permanece parcial: conectar o gateway e a resposta real, comprovar exposição e ligar aprovação à publicação durável antes de habilitar a interface. Sem implantação ou chamadas de IA.

[Nona entrega: despacho fixado e resultado do chat](revenue-intelligence-chat-dispatch-2026-09-24.md). Conecta a admissão ao gateway em um despachante interno, fixa provedor/modelo/ferramentas e registra a conclusão após conferir pausa, prazo, sessão e configuração. Repetições e tentativas incertas não fazem novo envio. RI-09 permanece parcial: integrar a chave durável da mensagem e a publicação transacional da resposta/ferramentas ao fluxo real antes de afirmar exposição ou habilitar aprovação. Sem implantação ou chamadas externas de IA.

[Décima entrega: identidade durável da mensagem no chat real](revenue-intelligence-chat-requests-2026-09-24.md). Envolve o caso de uso de checkout com admissão por loja/sessão/mensagem, impede reexecução concorrente e preserva efeitos incertos. Contrato público transporta chave e recibo; o filtro de erros mantém somente a projeção permitida. RI-09 permanece parcial: chamadores, reconciliação e publicação transacional da resposta/ferramentas ainda são necessários para integrar o despachante e liberar aprovação. Configuração desabilitada; sem implantação.

[Décima primeira entrega: gravação atômica da conversa](revenue-intelligence-chat-exchanges-2026-09-24.md). Salva comprador e agente juntos, vincula evidência imutável à requisição protegida, exige essa evidência para concluir novos recibos e impede sobrescritas de históricos já protegidos. Corrige a perda dos turnos na seleção de pagamento. RI-09 permanece parcial: efeitos das ferramentas/provedores, revalidação da estratégia no ponto de publicação, exposição e reconciliação continuam pendentes antes de integrar o despachante e liberar aprovação. Sem implantação.

[Décima segunda entrega: decisão transacional de publicação](revenue-intelligence-chat-publication-2026-09-24.md). Vincula a admissão à requisição durável e revalida a estratégia ao gravar texto, com decisão imutável de publicação/supressão e proteção contra contorno pelo builder comum. Não executa ferramentas nem personalização por memória. RI-09 permanece parcial: adaptar o contexto e o fluxo principal, controlar ferramentas, reconciliar tentativas e comprovar entrega antes de liberar aprovação. Nova flag desabilitada; sem implantação.

[Décima terceira entrega: contexto derivado da sessão](revenue-intelligence-session-context-2026-09-24.md). Monta os campos dinâmicos da estratégia a partir da sessão bloqueada, recusa contexto fornecido pelo chamador e preserva a admissão única após alterações. Corrige o total em reais também no chat principal e versiona o baseline para impedir reutilização silenciosa de propostas anteriores. RI-09 permanece parcial: integração ao fluxo principal, ferramentas, reconciliação, entrega e ativação continuam pendentes. Sem implantação.

[Décima quarta entrega: estratégia textual no chat principal](revenue-intelligence-main-chat-2026-09-24.md). Conecta o caso de uso real à admissão, ao gateway fixado e à publicação transacional para respostas textuais compatíveis. Exige chave durável nas sessões atribuídas, rejeita contexto desatualizado e impede retorno silencioso ao provedor/ferramentas legados nesse percurso. Preserva rotas determinísticas e holdout. RI-09 permanece parcial: paridade completa do controle, ferramentas, pagamento, reconciliação, chamadores, entrega e aprovação/ativação ainda impedem o piloto. Nova flag desabilitada; sem implantação.

[Décima quinta entrega: recuperação do texto já publicado](revenue-intelligence-chat-recovery-2026-09-24.md). Reconcilia recibos interrompidos somente com evidência imutável de publicação no novo percurso textual do chat principal. Impede reenvio e conclusão por processos atrasados, preserva o recibo em tentativas repetidas e libera a próxima mensagem distinta. Expõe operações autenticadas na API pública e no embed, com isolamento por loja e configuração explícita. RI-09 permanece parcial: tentativas sem prova, ferramentas, pagamento, chamadores, controle completo, exposição e aprovação/ativação continuam pendentes. Migration aplicada apenas ao banco descartável; recurso desabilitado por padrão.

[Décima sexta entrega: recuperação automática no widget](revenue-intelligence-widget-recovery-2026-09-25.md). Conecta o widget v2 à chave durável, à leitura autenticada da conversa e à recuperação do texto já salvo. A retomada ocorre em segundo plano, com tentativas limitadas e sem botão de verificação para o comprador. Não repete a chamada de IA nem avança por fallbacks locais de pagamento. RI-09 permanece parcial: outros chamadores, paridade completa, efeitos de ferramentas/pagamento, exposição e aprovação/ativação continuam pendentes. Validação local de cliente, API, PostgreSQL e navegador com HTTP controlado; sem implantação ou ativação.

[Décima sétima entrega: continuidade da escolha de pagamento](revenue-intelligence-payment-selection-2026-09-25.md). Persiste o método junto com as mensagens, permite seguir da comunicação experimental para o pagamento normal e retira chamadas de IA da seleção e do estado pendente. Vincula a chave financeira à requisição durável e preserva incertezas, sem transformar seleção em confirmação. Baseline versionado e migration aplicada somente ao PostgreSQL descartável. RI-09 permanece parcial: conciliação financeira, paridade completa, exposição/resultados, regras de parada e aprovação/ativação ainda impedem o piloto. Validação local com provedores controlados; sem implantação ou ativação.

[Décima oitava entrega: recuperação do pagamento existente](revenue-intelligence-payment-recovery-2026-09-25.md). Reconcilia o recibo interrompido com prova financeira persistida e permite ao widget retomar o mesmo pagamento por leitura autenticada, sem nova cobrança ou ação técnica do comprador. Confere contexto comercial, loja, sessão, valores e versão; preserva incertezas e impede reapresentar cobranças antigas quando há uma tentativa posterior. Distingue pagamento aprovado de pedido concluído. Migration aplicada somente ao banco descartável, baseline versionado e flag desabilitada. RI-09/10 permanecem parciais: paridade completa, outros chamadores, entrega/exposição, resultados econômicos, regras de parada e ligação da aprovação à ativação ainda impedem o piloto. Validação local documentada com provedores e HTTP controlados; sem implantação ou ativação.

[Décima nona entrega: exibição informada pelo widget](revenue-intelligence-message-display-2026-09-25.md). Distingue mensagem persistida de texto visível no cliente, com referência emitida pelo servidor, autenticação por sessão, hash exato e prova imutável deduplicada. Recuperação e reload mantêm a identidade; falhas de telemetria não bloqueiam o checkout. A declaração do cliente não comprova leitura humana ou efeito comercial. Validação local integral de 176 cenários PostgreSQL e 21 de navegador com HTTP controlado; sem implantação ou ativação. Métricas por participação, economia e ciclo completo ainda pendentes.

[Vigésima entrega: resultados por estratégia e versão](revenue-intelligence-strategy-results-2026-09-25.md). A medição passa a usar os participantes imutáveis da execução, incluindo não compradores, e separa maturidade, pedidos, receita observada, publicação e exibição informada. A API coleta com deduplicação horária e o dashboard mostra resultados da versão exata, preservando a última coleta em falhas. Validação local de 40 testes e duas jornadas de navegador; sem implantação, ativação ou efeito comercial comprovado. Economia, parada, acompanhamento operacional e ciclo de aprovação continuam pendentes.

[Vigésima primeira entrega: custo de produtos preservado por pedido](revenue-intelligence-catalog-cost-2026-09-25.md). Captura atomicamente o custo do catálogo da própria loja para pedidos participantes, com histórico imutável, cobertura explícita e ausência de backfill. Valores enviados no carrinho, custos ausentes e opções sem custo verificado não viram margem comprovada. O dashboard mostra o total apenas com cobertura de todos os pedidos do grupo. Validação local de 25 testes, schema/TypeScript e jornadas de navegador; sem implantação ou ativação. Taxas, frete, IA, paradas e ciclo completo de aprovação seguem pendentes.

[Vigésima segunda entrega: orçamento e consumo de IA por estratégia](revenue-intelligence-strategy-ai-budget-2026-09-28.md). As chamadas fixadas compartilham os tetos do planejador, reservam antes do envio e conservam custo incerto. O dashboard mostra estimativas na moeda original e sua cobertura. Regressão de 162 cenários exercitada, com dois doubles corrigidos e retestados; nove testes de gateway, TypeScript e navegador passaram. Sem provedor real ou ativação.

[Vigésima terceira entrega: cadeia de migrations de implantação](revenue-intelligence-deploy-migrations-2026-09-28.md). As migrations agora estão na pasta efetivamente usada pelo deploy. Ensaio local aplicou 49 migrations em banco vazio, a dependência adicional de negociação e repetiu o comando sem pendências. Diferenças preexistentes em outros módulos estão registradas e exigem avaliação antes de publicar; nenhuma implantação ocorreu.

[Vigésima quarta entrega: acompanhamento e encerramento automático](revenue-intelligence-strategy-monitor-2026-09-28.md). Coleta horária independente do dashboard, sem LLM, com encerramento no horizonte, acompanhamento da maturidade e notificação final deduplicada. Parada de segurança para dados inválidos/estouro de custo; nenhuma promoção automática. Oito testes PostgreSQL, dois de job/Redis, TypeScript e navegador passaram. RI-09/RI-10 continuam parciais: aprovação/ativação, transição de sessões ao encerrar, paridade completa e economia integral ainda precisam ser concluídas.

[Vigésima quinta entrega: continuidade do checkout após o encerramento](revenue-intelligence-checkout-continuation-2026-09-28.md). Novas mensagens de sessões de testes pausados, encerrados ou expirados seguem o fluxo normal, preservando atribuição, métricas tardias e bloqueios de tentativas incertas. O percurso usa regras vigentes da loja e protege o carrinho contra sobrescrita concorrente. Dez novos testes de continuação, regressões focadas, cinco cenários de ofertas e TypeScript passaram; oito falhas preexistentes de cadastro foram confirmadas no commit anterior. Aprovação/ativação e paridade integral continuam pendentes. Sem implantação ou chamadas externas.

[Vigésima sexta entrega: jornada de cadastro até o pedido medido](revenue-intelligence-checkout-journey-2026-09-28.md). Exercita os serviços reais com PostgreSQL e transportes controlados nos dois grupos. Corrige a interpretação do telefone inicial e a continuidade após reconhecimento de comprador que interrompe a participação. Preserva atribuição e bloqueios de tentativas incertas. Passaram 44 cenários PostgreSQL, 53 testes de regressão e TypeScript; um teste antigo segue ignorado. As falhas de fixtures de cadastro registradas na entrega anterior foram resolvidas. Pagamento e provedores simulados; aprovação/ativação, paridade completa e economia integral permanecem pendentes. Sem implantação.
