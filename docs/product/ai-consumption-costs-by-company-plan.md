# Consumo e custos de IA por empresa

Data: 18/10/2026. Estado: mapeamento de código e planejamento; implementação e publicação pendentes.

## Resultado esperado

Evoluir a área **Uso de IA** do Zyon Control para responder quanto cada empresa consumiu e quanto esse consumo custou à plataforma, com separação de texto, jornada de voz, modelos e funcionalidades. Cada total deve permitir chegar aos lançamentos que o compõem.

A medição deve incluir as chamadas feitas dentro e fora do agente de conversas. Uma mensagem do comprador pode gerar várias chamadas de modelo, inclusive ferramentas, novas tentativas e serviços auxiliares.

## Diagnóstico verificado

Foram comparados o checkout local em `C:\Users\Admin\Desktop\AACP` e a árvore `631bdd5`, usada na última entrega de atendimento técnico, em `C:\tmp\zyon-platform-support-release-20261018`. Esta análise não consultou faturas, preços contratados nem o conteúdo dos bancos remotos. Arquivos locais e uma tela publicada não comprovam captura em produção.

| Área | Base da última entrega | Trabalho local | Ajuste necessário |
| --- | --- | --- | --- |
| Persistência | Schema e migrações de `AiUsageEvent` e `AiPriceVersion` presentes | Casos de uso e repositórios adicionais presentes | Integrar a captura à aplicação que será efetivamente publicada |
| Storefront | Agente retorna tokens e usa contador em memória; sem callback persistente `onUsage` nessa árvore | Callback por chamada e `RecordAiUsageUseCase` presentes | Consolidar sem perder funcionalidades da versão publicada; cobrir sucesso, falha e ausência de uso |
| Demais chamadas | Vários clientes HTTP independentes | Continuam sem ligação com o registrador central | Instrumentar todas as origens relacionadas abaixo |
| Voz | WebSocket de controle no servidor já existe; compra, narração e transcrição configuradas | Registrador adicional depende de uso encaminhado pelo navegador | Receber uso diretamente do provedor no servidor, com identidade da chamada |
| Consulta admin | Agrega somente `storefront_langgraph` e `openai_realtime_client_forwarded` | Mantém filtros equivalentes | Consultar todas as origens válidas; separar confiança, canal, componente e estado |
| Custos | Migração inicial contém quatro tarifas legadas de OpenRouter | Estimador e conciliação adicionais, ainda não integrados à árvore de entrega | Validar tarifas dos modelos utilizados e preservar valores informados pelo provedor |
| Interface | Área Uso de IA com período, totais por empresa e aviso de cobertura parcial | Estrutura semelhante | Acrescentar custo por categoria, evolução, filtros e detalhamento de lançamentos |

O cliente principal de conversas é HTTP compatível com OpenAI, implementado em `packages/conversation-engine/src/langgraph/openrouter-provider.ts`. O nome LangGraph aparece no agente, mas esse cliente não depende de `@langchain/openai`. Portanto, um callback de LangChain sozinho não cobre o sistema.

## Inventário de origens

Os caminhos abaixo são relativos à raiz do repositório. A presença no código identifica um ponto a instrumentar; a ativação de cada ramo depende do fluxo e das configurações do ambiente.

| Origem | Arquivo ou ponto principal | Lacuna e atribuição |
| --- | --- | --- |
| Conversa da loja | `apps/api/src/modules/storefront/infrastructure/agents/store-langgraph-agent.ts` | Capturar cada chamada do loop e cada fallback, com empresa e conversa do servidor |
| Motor compartilhado | `packages/conversation-engine/src/langgraph/openrouter-provider.ts`, `langgraph-agent.ts` e `src/index.ts` | Preservar ID, modelo, provedor efetivo e uso; cobrir Chat Completions e Responses |
| Checkout | `apps/api/src/modules/checkout/application/services/chat-llm-gateway.service.ts` e `infrastructure/adapters/langgraph-conversation.adapter.ts` | Hoje há retornos que preservam somente conteúdo e ferramentas; propagar empresa e sessão |
| Gateway alternativo da loja | `apps/api/src/modules/storefront/infrastructure/ai/ai-gateway.service.ts` e seus clientes | Contador e estimativa locais não substituem lançamentos persistidos; verificar ramos realmente utilizados |
| Suporte automático ao comprador | `apps/api/src/modules/support/infrastructure/openai-chat.adapter.ts` | A porta `ChatCompletionPort.complete` precisa receber contexto da empresa/conversa; não confundir com conversa humana de atendimento técnico |
| Imagens enviadas na loja | `apps/api/src/modules/storefront/application/services/storefront-attachment-interpreter.service.ts` | Extrator chama modelo e descarta uso; receber contexto da conversa antes da chamada |
| SEO de produto | `apps/api/src/modules/catalog/application/use-cases/generate-product-seo.use-case.ts` | Registrar consumo atribuído ao produto e à empresa |
| Geração de catálogo | `apps/api/src/modules/catalog/presentation/http/catalog.controller.ts` | Usar o tenant autenticado que hoje aparece como `_merchantId` no gerador |
| Geração para empresa | `apps/api/src/modules/merchant/presentation/merchant.controller.ts` | Propagar tenant autenticado ao cliente de IA |
| SEO da loja | `apps/api/src/modules/store-settings/application/use-cases/generate-seo-suggestions.use-case.ts` | Medir chamada e uso com a empresa do caso de uso |
| Revenue Manager | `apps/api/src/modules/revenue-manager/infrastructure/hypothesis-generator.adapter.ts` | Propagar empresa também nos jobs; preservar eventual controle de orçamento existente |
| Texto de pós-venda | `apps/api/src/modules/post-sale/application/services/post-sale-ai-copywriter.service.ts` | Propagar empresa para o gerador interno; registrar cada tentativa de provedor |
| Embeddings de catálogo | `apps/api/src/modules/catalog/infrastructure/services/embedding.service.ts` | Recebe apenas texto; incluir empresa tanto na indexação quanto na busca |
| Embeddings do motor | `packages/conversation-engine/src/config-context/embedding-service.ts` | Registrar quando houver chamada externa; cache e implementação local não geram nova inferência paga |
| Compra por voz | `apps/api/src/shared/openai/openai-realtime-voice.service.ts` | Observar uso no WebSocket de controle existente, vinculado à chamada e ao modelo efetivamente criado |
| Narração de produto | Métodos `createProductNarrationCall` e `createProductNarrationClientSecret` na base de entrega | Incluir narração no inventário; resolver a captura do caminho com credencial efêmera sem removê-lo silenciosamente |
| Transcrição de voz | `session.audio.input.transcription` na base de entrega | Medir o modelo de transcrição separadamente quando o provedor cobrar/reportar esse serviço |

## Registro de consumo

1. Criar uma tentativa antes de chamar o provedor, com identificador próprio e contexto validado. Concluir a tentativa com uso conhecido, rejeição antes do processamento ou resultado desconhecido.
2. Reaproveitar `AiUsageEvent` e o registrador existente, com mudanças aditivas para contexto de conta, tentativa, origem de medição e detalhes de tokens. Avaliar um registro de tentativa separado para persistir chamadas ainda sem evento final.
3. Registrar `merchantId` obtido do tenant, da conversa autorizada ou do job. Nunca confiar no identificador de empresa enviado em metadados do navegador. Jobs precisam carregar contexto explícito e validá-lo no consumo.
4. Guardar a conta comercial da empresa no momento do consumo para permitir agrupar várias lojas e preservar histórico quando uma loja mudar de conta. Custos internos sem empresa ficam em um grupo próprio, sem atribuição inventada.
5. Identificar quem paga a credencial: plataforma ou empresa. Se houver chave própria do cliente, mostrar seu consumo separadamente para não incluí-lo como despesa da plataforma.
6. Preservar provedor de cobrança, provedor executor quando conhecido, modelo solicitado e modelo efetivo, ID da resposta, conversa, sessão de voz, funcionalidade, horário, latência e estado da tentativa.
7. Normalizar `usage_metadata` quando existir LangChain e `usage` nos clientes HTTP. Preservar entrada, saída, total e detalhes de cache, raciocínio, texto, áudio e imagem quando fornecidos. Detalhes que são subconjuntos não são somados novamente ao total.
8. Capturar por chamada do modelo, inclusive chamadas de ferramentas e novas tentativas. O agregado final da conversa é derivado e não gera outro lançamento de consumo.
9. Distinguir uso ausente de zero informado. Timeout depois do envio, resposta inválida, cancelamento ou ausência de metadados permanecem pendentes quando o consumo não puder ser determinado.
10. Deduplicar por provedor, conta/credencial de cobrança, ID da resposta e componente. Se o provedor não fornecer ID, usar a tentativa persistida. Reentrega do mesmo evento não soma custo; uma nova chamada física é outra tentativa.

Os pacotes de domínio continuam sem dependências de NestJS ou Prisma. Eles expõem metadados/callbacks e recebem contexto; a persistência fica na API. O coletor não precisa guardar prompt, resposta, arquivo, transcrição ou áudio.

## Custos e tarifas

O consumo observado e a certeza do custo são dimensões distintas: tokens recebidos do provedor podem ter custo apenas estimado.

| Estado | Uso no relatório |
| --- | --- |
| Informado pelo provedor | Custo retornado no servidor pelo provedor para aquela chamada; ainda pode haver ajustes de fatura |
| Estimado | Uso conhecido multiplicado pela tarifa válida na data da chamada |
| Conciliado | Valor conferido com exportação/fatura, com referência e trilha de ajuste |
| Sem tarifa | Uso conhecido, mas preço/modelo/modalidade sem correspondência validada |
| Uso pendente | Tentativa conhecida com resultado de consumo desconhecido; não equivale a custo zero |

Priorizar o custo informado pelo provedor, quando disponível e com moeda/unidade contratualmente identificadas. O OpenRouter documenta `usage.cost` e também um custo upstream: não somar os dois, pois representam perspectivas diferentes do mesmo gasto. Preservar a referência para reconciliação.

Para estimativas, usar tarifas versionadas por provedor de cobrança, modelo efetivo, modalidade, componente, unidade e vigência. Incluir cache de leitura/escrita e regras específicas somente quando verificadas na fonte oficial ou no contrato da conta. Tarifas antigas presentes no código não devem ser apresentadas como preços atuais confirmados.

Persistir valores em precisão decimal fixa ou inteiros de alta precisão, com política explícita de arredondamento. Não usar ponto flutuante para acumular dinheiro. Preservar a versão e os valores usados no cálculo; alterar tarifa não recalcula silenciosamente o passado.

Mostrar USD e demais moedas separadamente. Uma visão em BRL deve informar a cotação e a data utilizadas, com valor convertido identificado como estimativa. Só chamar de custo financeiro efetivo quando houver evidência de câmbio, taxas e ajustes aplicáveis.

A conciliação atualiza o estado/valor do lançamento com histórico de ajuste, sem adicionar novamente a estimativa ao custo conciliado. O relatório mostra o total conhecido, sua composição e as pendências. Sem histórico atribuído, não há retropreenchimento confiável por empresa: recuperá-lo exige IDs, logs/exportações e vínculo verificável com cada tenant.

## Medição de voz

Reaproveitar a conexão de controle do servidor com a sessão Realtime. A associação empresa → conversa → chamada do provedor → sessão/modelo deve ser persistida antes da primeira geração. Receber e persistir eventos finais de uso enquanto a conexão existir, inclusive respostas interrompidas com consumo informado.

Separar no detalhamento:

- Áudio recebido pelo modelo.
- Áudio gerado pelo modelo.
- Texto de entrada e saída utilizado na sessão de voz.
- Transcrição cobrada separadamente, quando aplicável.
- Narração de produtos.
- Chamadas do agente comercial executadas durante a jornada de voz.

Uma consulta por voz pode acionar uma chamada textual do agente comercial. Ela deve aparecer no custo completo da jornada de voz por correlação, mantendo seu tipo técnico de texto. O total geral soma cada lançamento uma única vez. Exibir tanto custo de áudio quanto custo completo da jornada evita confundir as duas medidas.

Usar ID real da sessão/chamada para contar sessões; três componentes de uma resposta não são três sessões nem três requisições. Duração e minutos são indicadores operacionais, não substituem a unidade de cobrança do provedor. Contexto reenviado em outra resposta deve seguir o uso reportado para aquela resposta.

Eventos encaminhados pelo navegador podem servir como observação auxiliar, mas não criar gasto autoritativo. No período de transição, a observação do servidor e a do cliente precisam convergir no mesmo evento, com precedência do servidor e sem duplicação. Desconexão antes do evento final deve marcar cobertura incompleta e gerar pendência de reconciliação.

## Experiência no Control

Manter a entrada **Uso de IA** e evoluir a tela existente, aproveitando o sistema visual do painel.

| Nível | Conteúdo |
| --- | --- |
| Resumo do período | Custo conhecido total por moeda, custo de texto, custo de voz, empresas com consumo e pendências de medição/preço |
| Empresas | Empresa/conta, lojas, chamadas, tokens de entrada/saída, sessões de voz, custo textual, custo de áudio, custo completo de voz e total |
| Detalhe da empresa | Evolução diária, distribuição por funcionalidade/provedor/modelo, custo médio por chamada e por sessão com cobertura conhecida |
| Lançamentos | Data, funcionalidade, modelo/provedor efetivos, chamada/conversa, tokens detalhados, custo, tarifa, estado e origem da medição |

Filtros: período, busca de empresa, conta/loja, origem, modelo, provedor, texto/voz e estado do custo. Paginação e ordenação pelo custo precisam operar no conjunto completo; os indicadores gerais não podem somar apenas as primeiras 100 empresas.

Incluir exportação CSV autorizada dos mesmos filtros, com valores decimais preservados e proteção de células interpretáveis como fórmulas. Valores menores que um centavo precisam de precisão visível, em vez de aparecer sempre como `0,00`. Estados vazios distinguem ausência de consumo, ausência de medição e falha de consulta.

Atualização inicial por consulta periódica enquanto a aba estiver visível, com horário da última atualização. WebSocket não é pré-requisito para a contabilização: o banco é a fonte de verdade e a atualização da tela não pode alterar valores.

Reutilizar `platform:ai-usage:read` e a auditoria de leitura, respeitando os papéis existentes. Escrita de tarifas, reconciliação e exportação exigem permissões adequadas e trilha própria. Custos internos ficam no Control; não viram automaticamente cobrança, limite ou alteração de plano do cliente.

## Sequência e impacto

| Etapa | Entrega | Impacto e condição de conclusão |
| --- | --- | --- |
| 1 — Base de entrega | Checkout isolado a partir da entrega atual; inventário de ramos ativos e modelos configurados, sem revelar segredos | Evitar regressão de checkout, voz, narração, cupons e atendimento técnico; reaproveitar trabalho local somente após revisão |
| 2 — Captura comum | Contexto, normalização, tentativa, identidade do provedor e persistência durável; integrar cada origem do inventário | Mudanças em portas/casos de uso/jobs; testes por origem e sem chamadas externas novas além das solicitadas pelo produto |
| 3 — Voz | Associação de sessão, coleta pelo servidor, transcrição/narração, correlação com agente comercial e deduplicação | Reutilizar o WebSocket existente; validar interrupção, fechamento, reconexão e caminhos de credencial efêmera |
| 4 — Precificação | Tarifas verificadas, custo reportado e fluxo de conciliação | Migrações aditivas em `prisma/migrations` e `prisma/deploy-migrations`; histórico preservado e sem alteração de preços comerciais |
| 5 — APIs e painel | Agregados completos, série diária, detalhamento paginado e CSV | Atualizar consultas que hoje filtram duas origens; índices por período/empresa e consultas limitadas |
| 6 — Validação e entrega | Banco/Redis descartáveis, browser, sandbox e produção com evidências separadas | Publicar somente a mudança revisada; provar persistência e somas, além de build/readiness |

Persistência de tentativa deve falhar antes do envio quando não houver forma durável de registrar uma chamada paga. Depois de um envio bem-sucedido, falha na gravação do uso não deve repetir a inferência: reentregar somente o evento, com fila/retry, alarme e estado pendente. Não executar uma segunda chamada de LLM apenas para medir a primeira.

Começar com agregação indexada sobre os lançamentos, medir volume e plano de execução, e introduzir projeções diárias idempotentes caso necessário. Leituras do admin não devem competir com as transações do checkout em varreduras sem limite.

## Critérios de aceite

1. Duas empresas concorrentes recebem somente seus próprios lançamentos; jobs e serviços auxiliares mantêm a atribuição correta.
2. Cada origem ativa do inventário tem prova de persistência e um teste que detecta perda de contexto ou metadados.
3. Uma mensagem com várias chamadas contabiliza todas uma vez; retry físico soma nova tentativa e reentrega do mesmo evento não duplica.
4. Fallback preserva provedor/modelo efetivos e distingue os custos conhecidos das tentativas anteriores pendentes.
5. Uso ausente, tarifa ausente e custo zero explícito aparecem como situações diferentes.
6. Entrada, saída, cache, raciocínio e componentes de áudio conservam os totais do provedor, sem somar subconjuntos duas vezes.
7. Uma sessão de voz com vários componentes conta como uma sessão; a soma da jornada inclui o agente comercial sem duplicar o total geral.
8. Voz continua contabilizada com navegador fechado quando o servidor ainda recebe o evento; ausência do evento final gera pendência visível.
9. Transcrição e narração têm provas próprias de captura ou indicação explícita de cobertura incompleta até sua implementação.
10. Tarifas por vigência e arredondamento são determinísticos; uma mudança de tarifa não altera silenciosamente o histórico.
11. Totais gerais, linha da empresa, série diária, lançamentos e CSV conferem para o mesmo período e moeda, mesmo com mais de 100 empresas.
12. Papéis sem permissão recebem 403; leitura/exportação/ajustes são auditados e não expõem conteúdo de conversas nem credenciais.
13. Uma verificação controlada no sandbox compara resposta do provedor, registro persistido e painel. Teste com resposta simulada não é descrito como prova de faturamento real.
14. Antes da produção, conferir migrações, modelos/tarifas ativos e identidade dos artefatos; depois, validar captura real autorizada e publicação da interface correspondente.

## Fontes técnicas consultadas

Consulta em 18/10/2026. Estes documentos confirmam os mecanismos de medição; não confirmam preços contratados da conta.

- [LangChain — mensagens e uso de tokens](https://docs.langchain.com/oss/javascript/langchain/messages): `usage_metadata` pode conter contagens e detalhes quando disponíveis; a presença deve ser verificada por chamada.
- [OpenRouter — Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting): uso, cache e custo no retorno; em streaming, observar o evento final.
- [OpenAI Docs — controle de voz no servidor](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime): conexão auxiliar do servidor à sessão existente; manter a API Realtime e os modelos já utilizados pelo produto.
- [OpenAI Docs — conversas Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations): eventos de ciclo de vida da resposta e encerramento da geração.
