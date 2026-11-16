# WhatsApp Service Booking and Business RAG Specification

**Approved**: 2026-11-14 - user: "Aprovar a especificação apresentada"
**Refinements approved**: 2026-11-14 - user: "Aprovar o plano e iniciar implementação local". Approval covers all 71 criteria and the 95-task plan, including later explicit refinements.
**Status:** Approved specification and refinements; tasks approved and Phase 1 implementation started locally.
**Amendment:** 2026-11-14 - user requested an About field in existing company data, a Conversations tab inside WhatsApp, a service-only Atendimento management page, manual scheduling and business-specific dashboard metrics. User also explicitly required preservation of the approved product journeys in WhatsApp and storefront. Original 47-requirement approval remains recorded above; additions are explicit for task review and have no fabricated approval date.
**Date:** 2026-11-14
**User-directed addition:** 2026-11-14 - a simple service-name list in company data, confirmed by "Lista simples em Dados da empresa (recomendado)" and "lembrando que e só para empresas de serviços". Adds ONB-06 to the original71 criteria; original approvals remain verbatim. This local addition is directly requested and does not authorize production actions.
**Size:** Complex

## Problem Statement

O Zyon já vende produtos pelo WhatsApp e tem componentes de serviços, slots e suporte. A experiência ainda não comprova uma agenda com vários profissionais, atendimento humano na mesma conversa e conhecimento alimentado automaticamente pelo cadastro da empresa. A validação de comércio não comprova prontidão para atendimento de clínicas ou outros prestadores de serviços.

## Goals

- [ ] Configurar uma empresa como vendedora exclusiva de produtos ou serviços desde o signup.
- [ ] Concluir agendamento por texto ou voz, escolhendo profissional, data e horário reais.
- [ ] Aplicar a política de bloqueio e pagamento configurada pela empresa, sem duplicar vagas ou pagamentos.
- [ ] Operar atendimento humano pelo módulo WhatsApp, com pausa e retomada persistidas da IA.
- [ ] Alimentar um RAG genérico com os dados públicos cadastrados e medir respostas por fontes e resultados verificáveis.
- [ ] Gerenciar profissionais, categorias, disponibilidade e agendamentos manuais em Atendimento, exclusivo para empresas de serviços.
- [ ] Exibir KPIs de serviço com estados operacionais e financeiros separados, preservando o painel de empresas de produtos.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Empresa vender produtos e serviços simultaneamente | Usuário escolheu modalidade exclusiva. |
| Agenda externa, Google Calendar ou prontuário eletrônico | Usuário escolheu agenda interna do Zyon. |
| Cancelamento/remarcação automáticos pelo comprador | Piloto usa a central humana e a política publicada. |
| Diagnóstico, prescrição e decisão autônoma de tratamento | O atendimento informativo não substitui atuação profissional. |
| Prontuários, exames e conversas privadas como corpus público | O RAG público usa informações públicas do negócio. |
| Central separada para editar conhecimento do RAG | O usuário determinou uso dos cadastros normais da empresa. |
| Publicação desta feature ou criação de cadastros clínicos em produção | Requer ação remota explicitamente autorizada, após a implementação aprovada e verificada. |
| Alterar os pedidos pagos e o estoque existentes da Athom | A validação deve preservar o estado real atual. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Modalidade comercial | Produtos ou serviços, exclusivamente | User: "Escolha exclusiva: produtos ou serviços" | y |
| Agenda | Interna, com vários profissionais | User: "Vários profissionais com agenda interna do Zyon" | y |
| Reserva temporária e pagamento | Configurados pela própria empresa | User: "configura tempo de bloqueio se bloqueia ou nao se pagamento sera automatizado ou na hora" | y |
| Sem bloqueio | Desativa somente reserva provisória; confirmado ocupa a vaga | User: "Sem bloqueio temporário; agendamento confirmado ocupa a vaga (recomendado)" | y |
| Cancelar/remarcar | Atendimento humano conforme política cadastrada | User escolheu "opção 1" para solicitação à central humana | y |
| Central | Dentro do módulo WhatsApp, na mesma conversa, com IA pausada | User: "devemos criar essa central no modulo de whatsapp" | y |
| Retorno da IA | Automático ao encerrar o atendimento humano | User: "Automaticamente quando o humano encerrar" | y |
| RAG | Genérico, alimentado pelo cadastro e pelas alterações da empresa | User: "todo cadastro vai gerando dados para o rag e alimentando" | y |
| Campo de apresentação | "Sobre a empresa" em Dados da empresa | Solicitação explícita do usuário; reaproveitar armazenamento canônico existente | y |
| Conversas humanas | Aba dentro de WhatsApp | User: "uma tab dentro de whatsapp ja e o suficiente" | y |
| Gestão de serviços | Nova página Atendimento somente para serviços | User: "pagina nova de atendimento mas so para emrpesas que vendem serviços" | y |
| Dashboard | KPIs ajustados à modalidade | User: "kpis e metricas do dashboard devem se ajustar para este tipo de negocio" | y |
| Isolamento técnico | Reaproveitar autenticação, tenant, inbox, pagamentos e fontes canônicas existentes | Padrão do repositório; a feature não concede acesso por texto do usuário | y |
| Dados para teste | Fatos e identidades sintéticos rotulados; nenhum paciente real | Permite testes locais sem criar oferta clínica real na Athom | y |

**Open questions:** none for specification review. Cadastros, conteúdo aprovado e política real de cada empresa são insumos de ativação, não respostas inventadas pelo sistema.

## User Stories

### P1: Business capability and onboarding

**User Story:** Como empresa, quero informar o que vendo e configurar meu atendimento para mostrar somente os recursos aplicáveis ao meu negócio.

**Acceptance Criteria:**

1. WHEN a empresa conclui o signup THEN the system SHALL persistir exatamente uma modalidade comercial, `products` ou `services`, selecionada em "O que sua empresa vende?". [ONB-01]
2. WHILE a modalidade é `products` the system SHALL ocultar as ações de agendamento e recusar tentativas de executá-las pela API, preservando a navegação atual de produtos. [ONB-02]
3. WHEN uma empresa de serviços configura atendimento THEN the system SHALL exigir a escolha explícita de bloqueio temporário, duração positiva em minutos quando habilitado, e pagamento `online` ou `at_attendance`. [ONB-03]
4. IF uma troca de modalidade conflita com ofertas ativas ou agendamentos existentes THEN the system SHALL recusar a troca com a indicação do conflito, sem excluir nem converter registros. [ONB-04]
5. WHEN a empresa edita Dados da empresa THEN the system SHALL permitir salvar e reabrir o campo "Sobre a empresa" usando a descrição pública canônica, sem duplicar seu armazenamento. [ONB-05]

**Independent Test:** Signup em cada modalidade; leitura após novo login; tentativa direta de agendar em empresa de produtos; configuração inválida; troca de modalidade com registros ativos.

### P1: Professionals, dates and slots

**User Story:** Como comprador, quero escolher um profissional e ver datas e horários disponíveis para reservar o serviço certo.

**Acceptance Criteria:**

1. WHEN a empresa publica um serviço agendável THEN the system SHALL vincular sua duração e profissionais a recursos de agenda da própria empresa. [AGENDA-01]
2. WHEN o comprador abre um serviço THEN the system SHALL apresentar datas com disponibilidade atual para o serviço e profissional selecionados. [AGENDA-02]
3. WHEN o comprador escolhe uma data THEN the system SHALL mostrar somente os slots disponíveis dessa data, informando início, duração e fuso do atendimento. [AGENDA-03]
4. WHEN o comprador seleciona um horário THEN the system SHALL revalidar o slot e mostrar serviço, profissional, data, hora e valor antes da confirmação. [AGENDA-04]
5. IF dois serviços do mesmo profissional disputam intervalos sobrepostos THEN the system SHALL permitir no máximo um agendamento confirmado nesse intervalo. [AGENDA-05]
6. IF a agenda está vazia, desatualizada ou indisponível THEN the system SHALL informar o estado correspondente sem criar horário ou declarar indisponibilidade total a partir de uma falha de leitura. [AGENDA-06]
7. WHEN texto ou áudio descreve uma data ou profissional ambíguo THEN the system SHALL pedir a escolha explícita entre as opções atuais antes de reservar ou cobrar. [AGENDA-07]

**Independent Test:** Dois profissionais, três serviços e duas datas; serviços diferentes com o mesmo profissional; competição concorrente pelo mesmo intervalo; slot vencido; leitura com erro; áudio ambíguo.

### P1: Booking and payment policies

**User Story:** Como empresa, quero controlar reserva provisória e recebimento sem permitir inconsistência entre agenda, pedido e pagamento.

**Acceptance Criteria:**

1. WHERE bloqueio temporário está habilitado the system SHALL reservar provisoriamente o intervalo pelo tempo configurado, exibindo seu vencimento pelo relógio do servidor. [BOOK-01]
2. WHEN uma reserva provisória vence ou é abandonada THEN the system SHALL liberar somente o bloqueio provisório correspondente, sem liberar um agendamento já confirmado. [BOOK-02]
3. WHERE bloqueio temporário está desabilitado the system SHALL revalidar a capacidade no ato da confirmação, sem garantir a vaga durante a seleção. [BOOK-03]
4. WHERE pagamento é `at_attendance` the system SHALL confirmar o agendamento atomicamente com a ocupação do horário e registrar pagamento pendente, sem criar cobrança antecipada. [BOOK-04]
5. WHERE pagamento é `online` the system SHALL confirmar o agendamento somente após a confirmação financeira do provedor e a aquisição válida da vaga. [BOOK-05]
6. IF pagamento é aprovado após a vaga se tornar indisponível THEN the system SHALL manter o pagamento real registrado e sinalizar regularização para a empresa, sem confirmar vaga inexistente nem cobrar novamente. [BOOK-06]
7. WHEN a empresa registra recebimento no atendimento THEN the system SHALL guardar valor, forma, operador e momento da quitação, sem apresentar esse registro como confirmação de um provedor externo. [BOOK-07]
8. IF mensagem, confirmação ou webhook é repetido THEN the system SHALL manter um único agendamento e uma única aplicação do mesmo evento financeiro. [BOOK-08]
9. WHEN o comprador solicita cancelar ou remarcar THEN the system SHALL encaminhar à central humana com o vínculo do agendamento e a política publicada da empresa. [BOOK-09]
10. WHEN uma reserva de serviço é concluída THEN the system SHALL emitir confirmação com serviço, profissional, data, hora, fuso e situação financeira, sem tratá-la como produto enviado ou baixar estoque físico. [BOOK-10]

**Independent Test:** Quatro combinações de bloqueio/pagamento; expiração por relógio controlado; duas confirmações concorrentes; pagamento tardio; webhook repetido; quitação local auditada; evento de confirmação e ausência de saída de estoque físico.

### P1: WhatsApp human support center

**User Story:** Como comprador, quero pedir um atendente na mesma conversa; como empresa, quero assumir, responder e encerrar pelo módulo WhatsApp.

**Acceptance Criteria:**

1. WHEN o comprador abre o Menu principal THEN the system SHALL apresentar a opção "Falar com atendente" sem ultrapassar o limite de opções de cada controle nativo. [HUM-01]
2. WHEN o comprador pede atendente por botão, texto ou voz, inclusive durante o checkout, THEN the system SHALL abrir ou reutilizar um atendimento vinculado à empresa e conversa autenticadas antes de confirmar o encaminhamento. [HUM-02]
3. WHILE o atendimento está aguardando ou sob atendimento humano the system SHALL pausar as respostas automáticas da IA sem perder carrinho, agendamento ou pagamento. [HUM-03]
4. WHEN operador autorizado acessa a central do módulo WhatsApp THEN the system SHALL permitir consultar a fila, assumir uma conversa, responder e encerrar somente atendimentos de sua empresa. [HUM-04]
5. WHEN operador envia resposta THEN the system SHALL persistir a mensagem e seu estado de entrega na conversa original, sem considerar aceite do provedor como leitura pelo comprador. [HUM-05]
6. WHEN operador encerra o atendimento THEN the system SHALL restaurar o modo IA e informar a devolução uma única vez, mesmo com eventos repetidos. [HUM-06]
7. IF a fila, a entrega ou a equipe está indisponível THEN the system SHALL informar o estado real, sem prometer atendimento imediato ou resposta já enviada. [HUM-07]
8. WHEN o operador abre o módulo WhatsApp THEN the system SHALL oferecer a aba "Conversas" para operar o atendimento humano existente sem exigir uma central separada para o RAG. [HUM-08]

**Independent Test:** Pedido durante coleta de dados; fila e tomada de conversa; resposta real na mesma thread; operador de outro tenant negado; fechamento duplicado; geração de IA em andamento ao iniciar handoff.

### P1: Automatic generic business RAG

**User Story:** Como empresa de qualquer ramo de serviços, quero que meus cadastros publicados alimentem o conhecimento do assistente sem manutenção manual de seeds.

**Acceptance Criteria:**

1. WHEN cadastro público da empresa, profissional, serviço, horário de funcionamento, FAQ ou política é publicado ou alterado THEN the system SHALL registrar atualização idempotente da projeção de conhecimento com tenant, origem e versão. [RAG-01]
2. WHEN uma fonte é retirada ou despublicada THEN the system SHALL impedir seu uso como evidência ativa e retirar sua projeção, sem recuperar texto antigo como resposta atual. [RAG-02]
3. IF embeddings ou grafo estão indisponíveis THEN the system SHALL conservar o cadastro canônico e registrar a indexação pendente para nova tentativa, sem desfazer o cadastro nem inventar uma resposta. [RAG-03]
4. WHEN o assistente compõe uma resposta factual THEN the system SHALL usar fontes públicas da empresa autenticada e conservar as referências de origem e versão para auditoria. [RAG-04]
5. WHEN a pergunta combina área de atuação, serviço, profissional, preço e disponibilidade THEN the system SHALL combinar recuperação semântica com leituras canônicas de serviço, preço e agenda, sem extrair confirmação financeira ou vaga de um embedding. [RAG-05]
6. IF não há fonte suficiente ou há conflito entre fontes THEN the system SHALL explicitar a lacuna e pedir esclarecimento ou encaminhar ao humano, sem atribuir à empresa um serviço, credencial ou política não publicada. [RAG-06]
7. The system SHALL excluir credenciais, prontuários, dados pessoais privados e conversas de clientes do corpus público e das respostas a outros compradores. [RAG-07]
8. WHILE a recuperação usa Neo4j Community the system SHALL executar somente consultas parametrizadas e aprovadas no gateway privado, sem executar Cypher livre fornecido pelo modelo ou comprador. [RAG-08]
9. WHEN um cenário de segmento regulado exige diagnóstico, prescrição ou decisão profissional individual THEN the system SHALL encaminhar ao profissional e limitar a resposta informativa ao conteúdo publicado aplicável. [RAG-09]
10. WHEN uma nova empresa de um ramo de serviços é cadastrada THEN the system SHALL aplicar o mesmo fluxo de ingestão e consulta sem FAQ, nomes ou especialidades médicos hardcoded. [RAG-10]
11. WHEN a empresa mantém apresentação, políticas, profissionais e horários em seus cadastros normais THEN the system SHALL alimentar o contexto desses registros sem exigir duplicação de conteúdo em uma central de RAG. [RAG-11]

**Independent Test:** Neurologia, salão e consultoria com conteúdo sintético; atualizações e remoções; contradições; falha de grafo; fonte de outro tenant; dados privados; prompt injection; consultas compostas com agenda operacional.

### P1: Service management page

**User Story:** Como empresa de serviços, quero organizar minha equipe, categorias e agenda e registrar agendamentos manuais no mesmo domínio usado pelo comprador.

**Acceptance Criteria:**

1. WHEN uma empresa de serviços abre a navegação administrativa THEN the system SHALL oferecer a página "Atendimento", negando sua gestão a empresas de produtos também nas rotas da API. [ATEND-01]
2. WHEN operador autorizado mantém profissionais THEN the system SHALL permitir cadastrar, editar e desativar profissionais da própria empresa, preservando o histórico de agendamentos. [ATEND-02]
3. WHEN operador mantém categorias de atendimento THEN the system SHALL vincular categorias e serviços publicados sem transformar categoria em recurso de capacidade. [ATEND-03]
4. WHEN a empresa publica disponibilidade de um profissional THEN the system SHALL considerar grade, duração do serviço, fuso e indisponibilidades na mesma leitura usada pelo WhatsApp, storefront e agendamento manual. [ATEND-04]
5. WHEN operador cria um horário avulso THEN the system SHALL validá-lo no fuso do profissional e impedir sobreposição com intervalos confirmados ou bloqueados. [ATEND-05]
6. WHEN operador cria um agendamento manual THEN the system SHALL aplicar a mesma capacidade, política financeira, identidade de cliente e idempotência usadas no fluxo de autoatendimento. [ATEND-06]
7. WHEN operador inicia, conclui ou registra ausência de um atendimento THEN the system SHALL persistir a transição operacional explícita sem inferir quitação financeira ou comparecimento pelo pagamento. [ATEND-07]
8. IF um operador tenta gerir profissional, categoria, grade ou agendamento de outra empresa THEN the system SHALL recusar a operação sem expor o registro solicitado. [ATEND-08]
9. WHEN operador bloqueia uma indisponibilidade THEN the system SHALL retirar o intervalo da oferta pública sem cancelar ou sobrepor silenciosamente agendamentos confirmados. [ATEND-09]
10. WHEN operador agenda fora da grade regular THEN the system SHALL permitir a criação explícita de horário avulso na mesma operação, sem sobreposição e sob a política de pagamento vigente. [ATEND-10]

**Independent Test:** Cadastro e desativação de profissional com histórico; categoria com serviços; mesma agenda nos três canais; agendamento manual em disputa com comprador; ações operacionais com pagamento local pendente; acesso de outro tenant.

### P1: Service dashboard metrics

**User Story:** Como empresa de serviços, quero ver minha operação e meus recebimentos por indicadores adequados, sem confundir agendamento com venda paga ou atendimento realizado.

**Acceptance Criteria:**

1. WHEN a empresa abre o dashboard THEN the system SHALL selecionar os indicadores da modalidade comercial persistida, mantendo os indicadores atuais para produtos. [KPI-01]
2. WHEN o painel contabiliza agendamentos do período THEN the system SHALL contar cada agendamento uma vez por estado operacional, usando o início agendado no fuso da empresa como coorte declarada. [KPI-02]
3. WHEN o painel calcula ocupação THEN the system SHALL dividir minutos ocupados confirmados pelos minutos ofertados únicos por profissional no período, sem duplicar capacidade de serviços que compartilham esse profissional. [KPI-03]
4. WHEN o painel mostra valores de serviços THEN the system SHALL separar valor agendado, valor a receber e recebimento confirmado, usando evidências financeiras próprias de pagamento online ou registro local. [KPI-04]
5. WHEN operador filtra período, profissional ou categoria THEN the system SHALL aplicar os mesmos limites de tenant e período aos totais e detalhamentos retornados pela API. [KPI-05]
6. WHEN o painel mostra concluídos ou ausências THEN the system SHALL usar somente os estados operacionais registrados, sem inferir conclusão por pagamento ou ausência pelo decurso do horário. [KPI-06]
7. IF uma leitura de métricas falha ou o denominador de uma taxa não existe THEN the system SHALL distinguir dados indisponíveis de zero e mostrar taxa não calculável sem fabricar percentuais. [KPI-07]

**Independent Test:** Agenda sintética conhecida com dois profissionais, serviços compartilhados, cancelamentos, ausência, concluídos não pagos e pagamentos sem comparecimento; fronteira de fuso; filtros; indisponibilidade; painel de produtos inalterado.

### P1: Preserve approved product journeys

**User Story:** Como empresa de produtos, quero continuar usando os fluxos já aprovados enquanto empresas de serviços recebem uma jornada própria.

**Acceptance Criteria:**

1. WHEN uma empresa usa WhatsApp ou storefront THEN the system SHALL selecionar a jornada pela modalidade canônica da empresa, sem aplicar políticas de agenda, pagamento no atendimento ou controles de profissional à compra de produtos. [REG-01]
2. WHEN a nova jornada de serviços é validada THEN the system SHALL comprovar nos dois canais a preservação de catálogo, busca e comparação, detalhes e avaliações, carrinho e cross-sell, identidade e endereço, frete e checkout, incluindo Pix, cartão e troca do método de pagamento de produtos. [REG-02]
3. WHEN pagamentos de produtos e agendamentos de serviços são processados na mesma revisão THEN the system SHALL preservar totais, recibos, transições de pedido, eventos e baixa de estoque físico de produtos, impedindo que eventos de serviço produzam envio ou saída de estoque físico. [REG-03]
4. WHEN a feature é migrada, habilitada ou desabilitada THEN the system SHALL preservar empresas e registros existentes, manter serviços novos desabilitados para empresas de produtos e conservar o processamento dos agendamentos e pagamentos já iniciados. [REG-04]

**Independent Test:** Dois tenants sintéticos, um de cada modalidade, no WhatsApp e storefront; matriz de comércio aprovada antes/depois; migração sobre fixture de dados anteriores; desativação de novas reservas com pagamentos pendentes e agendamentos confirmados preservados.

### P1: Evidence and acceptance

**User Story:** Como responsável pelo produto, quero comprovar UI, reservas, pagamentos e conhecimento antes de liberar uma empresa real.

**Acceptance Criteria:**

1. WHEN a feature é validada THEN the system SHALL produzir uma matriz que relacione cada critério ao comando e à evidência de seu resultado no mesmo HEAD. [QA-01]
2. WHEN o fluxo visual é demonstrado THEN the system SHALL fornecer prints das telas e conversas correspondentes, marcando separadamente prévias locais e capturas reais. [QA-02]
3. WHEN os testes financeiros e de concorrência são executados THEN the system SHALL comprovar unicidade de reserva, estado financeiro verdadeiro e isolamento de tenant, sem depender apenas da mensagem da IA. [QA-03]
4. WHEN o RAG é avaliado THEN the system SHALL medir respostas apoiadas por fonte, tratamento de ausência/contradição e uso correto de ferramentas em três ramos, exigindo aprovação de todos os casos críticos antes da ativação. [QA-04]

**Independent Test:** Relatório de provas, mutações independentes, revisão de telas e UAT por texto/voz no WhatsApp e storefront, com revisão profissional do corpus quando aplicável.

## Edge Cases

- IF um ID de profissional, empresa ou horário pertence a outro tenant THEN the system SHALL rejeitar a ação sem expor dados desse tenant. [EDGE-01]
- IF uma política muda durante uma reserva THEN the system SHALL exigir uma nova confirmação da condição comercial atual antes de criar cobrança ou reserva final. [EDGE-02]
- IF a mídia de confirmação falha THEN the system SHALL preservar a entrega do texto e o estado canônico já confirmado. [EDGE-03]
- IF um operador assume enquanto uma resposta da IA está em processamento THEN the system SHALL impedir o envio dessa resposta automática após a mudança de modo. [EDGE-04]
- IF a fonte contém instruções para executar ferramentas ou revelar dados THEN the system SHALL tratá-la somente como conteúdo recuperado, sem conceder autoridade operacional. [EDGE-05]

### P1: Public service names in company data

**User Story:** Como empresa de serviços, quero cadastrar uma lista simples do que ofereço em Dados da empresa para apresentar meu negócio e dar contexto ao assistente.

**Acceptance Criteria:**

1. WHILE a modalidade canônica é `services` the system SHALL permitir adicionar pelo botão "+", editar, remover, salvar e reabrir uma lista de nomes de serviços em Dados da empresa e usar somente os nomes públicos salvos como contexto do RAG, ocultando e recusando sua edição para empresas de produtos e retirando esse contexto quando a modalidade mudar para produtos. [ONB-06]

**Independent Test:** Na empresa de serviços adicionar dois nomes, editar/remover, salvar e recarregar com persistência real; provar os nomes na fonte pública atual, omissão preservando dados e lista vazia limpando contexto. Na empresa de produtos não mostrar o controle, recusar escrita direta e impedir uso de nomes históricos pelo RAG. A lista não cria preço, duração, disponibilidade ou oferta comercial.

## Requirement Traceability

| Requirement ID | Story | Tasks | Status |
| --- | --- | --- | --- |
| ONB-01 | Capability selection | T4, T8, T9, T10 | Implemented locally |
| ONB-02 | Conditional navigation and API | T7, T9, T10, T17, T19, T94 | In Progress (T17 and T19 complete) |
| ONB-03 | Merchant appointment policy | T4, T7, T11, T27, T81 | In Progress (T4, T7, T11 and T27 complete) |
| ONB-04 | Non-destructive mode change | T5, T7, T12, T17 | In Progress (T17 complete) |
| ONB-05 | About field in company data | T13, T14, T15, T16 | Implemented locally |
| ONB-06 | Service-name list in company data, services only | T96, T97, T63, T72 | In Progress (T96 and T97 complete; T72 pending) |
| AGENDA-01 | Professional resources | T4, T18, T20, T21, T76 | In Progress (T18, T20 and T21 complete) |
| AGENDA-02 | Dates | T23, T24, T43, T44, T45 | In Progress (T23 and T24 complete) |
| AGENDA-03 | Slots | T23, T24, T43, T44, T45 | In Progress (T23 and T24 complete) |
| AGENDA-04 | Selection summary | T28, T40, T42, T43, T45, T46 | Pending |
| AGENDA-05 | Shared capacity | T23, T26, T34 | In Progress (T23 and T26 complete) |
| AGENDA-06 | Empty/error states | T23, T24, T44 | In Progress (T23 and T24 complete) |
| AGENDA-07 | Text/voice ambiguity | T42, T46, T93 | Pending |
| BOOK-01 | Provisional hold | T27 | Implemented (T27; final proof pending) |
| BOOK-02 | Expiry | T27 | Implemented (T27; final proof pending) |
| BOOK-03 | No provisional hold | T26, T27, T28, T29, T40 | In Progress (T26 and T27 complete) |
| BOOK-04 | Pay at attendance | T30, T40, T46 | Pending |
| BOOK-05 | Pay online | T29, T35, T40 | Pending |
| BOOK-06 | Late payment | T36 | Pending |
| BOOK-07 | On-site receipt | T4, T37, T41, T80 | Pending |
| BOOK-08 | Idempotency | T26, T30, T31, T32, T33, T35, T36, T37, T38, T84 | In Progress (T26 complete) |
| BOOK-09 | Change requests | T33, T34, T41, T49, T80 | In Progress (T49 trusted intake/reference complete; operations/UI pending) |
| BOOK-10 | Confirmation and inventory | T35, T38, T39 | Pending |
| HUM-01 | Fixed menu entry | T57 | Pending |
| HUM-02 | Handoff intake | T49, T50, T57 | In Progress (T49 intake and T50 router complete; menu pending) |
| HUM-03 | AI pause | T4, T48, T49, T50, T51 | Complete locally (T4/T48-T51; final integrated verification pending) |
| HUM-04 | WhatsApp center | T52, T53, T58, T59, T60, T61, T62 | Pending |
| HUM-05 | Original conversation delivery | T53, T54, T55, T60, T61 | Pending |
| HUM-06 | Automatic AI resume | T56, T61 | Pending |
| HUM-07 | Unavailable team/provider | T54, T55, T58 | Pending |
| HUM-08 | Conversations tab inside WhatsApp | T58, T59, T60, T62, T82 | Pending |
| RAG-01 | Automatic indexing | T4, T21, T63, T64, T65, T66 | In Progress (indexing tasks complete; final proof pending) |
| RAG-02 | Retirement | T65, T67, T68 | Pending |
| RAG-03 | Retry and source durability | T64, T66, T67 | Implemented locally (T64, T66, T67 complete; final proofs pending) |
| RAG-04 | Source provenance | T66, T68, T69 | In Progress (T66 producer complete) |
| RAG-05 | Compound live queries | T70, T71 | Pending |
| RAG-06 | Insufficient/conflicting evidence | T68, T71 | Pending |
| RAG-07 | Public/private isolation | T6, T63, T68, T69 | Pending |
| RAG-08 | Controlled Cypher | T2, T70 | Pending |
| RAG-09 | Professional boundary | T71, T72 | Pending |
| RAG-10 | Generic onboarding | T63, T67, T71, T72 | Pending |
| RAG-11 | Existing forms feed context | T13, T14, T15, T63, T64, T65 | Pending |
| ATEND-01 | Service-only management | T41, T47, T73, T74, T75, T82, T83 | Pending |
| ATEND-02 | Professional administration | T18, T19, T76 | In Progress (T18 and T19 complete) |
| ATEND-03 | Service categories | T20, T77 | In Progress (T20 complete) |
| ATEND-04 | Shared availability | T21, T23, T24, T25, T78 | In Progress (T21, T23, T24 and T25 complete) |
| ATEND-05 | One-off times | T22, T25, T78 | In Progress (T22 and T25 complete) |
| ATEND-06 | Manual appointments | T31, T41, T74, T79 | Pending |
| ATEND-07 | Attendance lifecycle | T32, T41, T74, T80 | Pending |
| ATEND-08 | Management authorization | T6, T11, T19, T25, T41, T47, T52, T59, T73, T75, T83, T87 | In Progress (T19 and T25 complete) |
| ATEND-09 | Unavailability blocks | T22, T25, T78 | In Progress (T22 and T25 complete) |
| ATEND-10 | Explicit outside-hours appointment | T25, T31, T79 | In Progress (T25 complete) |
| KPI-01 | Business-specific dashboard | T82, T87, T88, T89, T90, T91 | Pending |
| KPI-02 | Appointment cohort and counts | T85, T86, T89 | Pending |
| KPI-03 | Capacity occupancy | T86, T89 | Pending |
| KPI-04 | Separate financial metrics | T37, T85, T86, T89 | Pending |
| KPI-05 | Consistent filters | T85, T87, T88, T91 | Pending |
| KPI-06 | Explicit attendance evidence | T32, T85, T86, T89 | Pending |
| KPI-07 | Unknown and empty metrics | T86, T87, T88, T89, T91 | Pending |
| REG-01 | Separate business journeys in both channels | T7, T9, T17, T28, T43, T45, T46, T47, T62, T82, T83, T90, T91, T93 | In Progress (T17 complete) |
| REG-02 | Approved product interactions | T3, T17, T28, T29, T46, T57, T90, T93 | In Progress (T17 complete) |
| REG-03 | Physical commerce financial and stock integrity | T2, T29, T35, T38, T92, T93 | Pending |
| REG-04 | Compatible migration and safe activation | T1, T3, T5, T7, T8, T12, T17, T36, T47, T84, T94 | In Progress (T17 complete) |
| QA-01 | Criteria proofs | T1, T95 | Pending |
| QA-02 | Screenshots | T3, T16, T39, T44, T61, T75, T89, T93, T95 | Pending |
| QA-03 | Persisted state proof | T2, T5, T26, T92, T95 | In Progress (T26 complete) |
| QA-04 | RAG evaluation | T72, T94, T95 | Pending |
| EDGE-01 | Foreign tenant identity | T6, T18, T22, T40 | In Progress (T18 and T22 complete) |
| EDGE-02 | Changed policy | T11, T28, T30, T40, T81 | Pending |
| EDGE-03 | Optional media failure | T38, T39 | Pending |
| EDGE-04 | In-flight AI response | T48, T51, T56 | In Progress (T48/T51 complete; T56 close/resume composition pending) |
| EDGE-05 | Retrieved-content injection | T70, T71 | Pending |

**Coverage:** 72 identified requirements: the original approved71 plus the directly requested ONB-06 service-name list. Product refinements are recorded in context.md; original approvals remain unchanged.

## Implicit Requirement Dimensions

| Dimension | Coverage |
| --- | --- |
| Input validation and bounds | ONB-01/03, AGENDA-04/07; positive hold duration, allowed policy modes, tenant-bound canonical IDs. |
| Failure and partial failure | AGENDA-06, BOOK-06, HUM-07, RAG-03/06; no false success. |
| Idempotency and duplicate handling | BOOK-08, HUM-02/06, RAG-01; existing inbox and outbox conventions. |
| Authorization and rate limits | ONB-02, HUM-04, RAG-04/07/08; reuse authenticated tenant limits and staff permissions. |
| Concurrency and ordering | AGENDA-05, BOOK-04/05, HUM-03 and stale-generation guard. |
| Data lifecycle and expiry | BOOK-01/02, RAG-02; confirmed reservation survives provisional-hold expiry. |
| Observability | QA-01/03/04; IDs of sources/events, state changes and delivery, with private fields redacted. |
| External dependency failure | BOOK-06, HUM-05/07, RAG-03; no duplicate provider action on uncertain result. |
| State transition integrity | BOOK-02/04/05/07, HUM-03/06; booking, finance and attendance have distinct states. |

## Sources

- Pedido e respostas do usuário em 2026-11-14; transcrição de decisões em context.md.
- Código inspecionado: `apps/api/src/modules/catalog/domain/services/service-schedule.ts`, `apps/api/src/shared/bookings/service-slot-holds.service.ts`, `apps/api/src/shared/persistence/order-fulfillment.ts`.
- Suporte existente: `apps/api/src/modules/support/application/support-handoff.service.ts`, `send-ticket-message.use-case.ts`; navegação em `whatsapp-channel/domain/ui/buyer-hub.ts`.
- RAG atual: `apps/api/src/modules/graph-rag/application/graph-projection.service.ts`, `graph-retrieval.service.ts` e `domain/graph-query.ts`.
- Signup atual inspecionado no workspace principal: `apps/dashboard/src/lib/signup-options.ts` e `apps/api/src/modules/auth/application/register-merchant.use-case.ts`; reconciliação com a revisão publicada será uma verificação do design.
- Não foram fornecidas novas capturas vinculantes para esta feature. As telas novas serão julgadas pelos resultados exigidos e pela identidade visual existente; as prévias das correções de UI são evidência separada.
- [CFM: uso de IA como apoio e decisão profissional humana](https://portal.cfm.org.br/noticias/regras-sobre-uso-da-ia-na-medicina-entram-em-vigor-no-dia-26-de-agosto), consultado em 2026-11-14.
- [WHO: limitações e governança de modelos generativos em saúde](https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models), consultado em 2026-11-14.

## Success Criteria

- [ ] Cadastro em uma modalidade não habilita ações da outra.
- [ ] WhatsApp e storefront preservam os fluxos de produtos aprovados enquanto serviços seguem sua jornada específica.
- [ ] Profissional não recebe dois agendamentos confirmados em intervalos sobrepostos.
- [ ] Quatro combinações de bloqueio/pagamento preservam agenda e situação financeira reais.
- [ ] Atendimento humano é operado no módulo WhatsApp e a IA retoma automaticamente ao encerrar.
- [ ] Cadastros públicos de três ramos alimentam o RAG sem seeds manuais como mecanismo normal.
- [ ] Todos os casos críticos, os testes vinculados aos critérios e a verificação independente passam antes de ativação.
