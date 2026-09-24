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
