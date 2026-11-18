# WhatsApp Service Booking and Business RAG Specification

**Discovered authentication prerequisite (2026-11-17):** Local source and real-hasher/JWT RED8 (3pass/5fail) reproduced password-login acceptance when verify returns valid:false. AUTH-01/T110 records the required rejection contract before service buyer authentication can be claimed. This corrects an existing security defect; no new business choice, provider action or production validation. Current scope82criteria/110tasks; original approvals remain unchanged.

**Discovered uncertain-replay repair (2026-11-17):** Actual owned SQL/incoming/Meta-adapter RED reproduced two physical local attempts after an unknown handoff notice, while legacy retained one. T109 repairs the existing HUM-03/HUM-07 contract independently from uncommitted T56, with no new criterion, product decision, timeout, provider action or oracle change. Current scope is81 criteria/109 tasks; original approvals remain unchanged. Historical close/new-handoff validation remains mandatory with T56/T57 after that capability exists.

**Approved**: 2026-11-14 - user: "Aprovar a especificaÃ§Ã£o apresentada"
**Refinements approved**: 2026-11-14 - user: "Aprovar o plano e iniciar implementaÃ§Ã£o local". Approval covers all 71 criteria and the 95-task plan, including later explicit refinements.
**Status:** Approved specification and refinements; tasks approved and Phase 1 implementation started locally.
**Amendment:** 2026-11-14 - user requested an About field in existing company data, a Conversations tab inside WhatsApp, a service-only Atendimento management page, manual scheduling and business-specific dashboard metrics. User also explicitly required preservation of the approved product journeys in WhatsApp and storefront. Original 47-requirement approval remains recorded above; additions are explicit for task review and have no fabricated approval date.
**Date:** 2026-11-14
**User-directed addition:** 2026-11-14 - a simple service-name list in company data, confirmed by "Lista simples em Dados da empresa (recomendado)" and "lembrando que e sÃ³ para empresas de serviÃ§os". Adds ONB-06 to the original71 criteria; original approvals remain verbatim. This local addition is directly requested and does not authorize production actions.
**Size:** Complex

**User-directed catalog addition:** 2026-11-16 - user: "ah e outra coisa em cadastrar produto cadastrar serviço so aparece para empresas de serviço para empresas sem ser de serviço nao precisa mais mostrar a opção de produto de sreviço para cadastrar". Adds CAT-01/CAT-02 and T98 as directly requested local UI work, reusing the already-approved canonical exclusive business mode and T17 API guard. Current scope is74 criteria/98 tasks. Original approvals remain verbatim; no new production authority. The separately requested human-alert telephone and service Kanban are being added to the local plan.

**Human-alert channel settled:** 2026-11-16 - user: "WhatsApp, com link para a conversa (recomendado)". The configured fallback telephone receives a minimal team notification with an authenticated dashboard link. The customer stays in the original WhatsApp conversation. The private recipient is separate from public company/RAG data. No SMS integration or production send is authorized by this local implementation decision.

**User-directed support and appointments additions:** 2026-11-16 - user requested natural-language human requests, a fallback phone in support settings and a separate services-only Kanban of scheduled services replacing the primary Orders entry. HUM-02/T57 explicitly include semantic paraphrases with the existing authenticated intake authority. HUM-09/HUM-10 and ATEND-11/ATEND-12 add four criteria and T99-T103, for78 criteria/103 tasks. These are directly requested local additions; original approvals and product-preservation gates remain.

**Discovered regression repair:** 2026-11-16 - required native revalidation reproduced a Neo4j client transaction timeout during cold initial projection. T104 tests a single atomic write statement under the unchanged deadline, version lock and source-retirement contract. This is an implementation repair within RAG-01/02/03, with no added business criterion or relaxed test. Current execution count78criteria/104tasks. The hypothesis is not declared fixed until actual unchanged native gates pass.

**User-directed catalog refinement:** 2026-11-16 - user: "está sim mas trar checkbox por toggle e poder vincular um profissional a um serviço se ja nao tiver". The shown business-mode split is accepted with these two refinements. CAT-03/CAT-04 and T105/T106 reuse existing ToggleSwitch and professional-service association endpoints. Current scope is80 criteria/106 tasks; this acceptance does not approve production or the final feature.

**Discovered catalog defect:** local105 browser captures exposed an advanced-rules error while editing a Starter offer. Existing PromotionSection fetches the Growth-only endpoint without checking the same hasFeature flag already used by its UI; the API entitlement stays authoritative. CAT-05/T107 repair that inconsistency before professional-link UI, without changing plans, prices or backend guards. Current81criteria/107tasks. The new assertion records the existing feature policy, not a new business choice; exact HTTP status and final visual proof remain part of its gate.

**Runtime prerequisite repair:** T108 replaces only the repeated slow Windows native socket collector while preserving its ownership contract and10s deadline. Current81criteria/108tasks. Its30old/new guard contracts and actual Windows connection pass locally; original54API9/105browser2 remain required separately, with no production or full-feature approval.

## Problem Statement

O Zyon jÃ¡ vende produtos pelo WhatsApp e tem componentes de serviÃ§os, slots e suporte. A experiÃªncia ainda nÃ£o comprova uma agenda com vÃ¡rios profissionais, atendimento humano na mesma conversa e conhecimento alimentado automaticamente pelo cadastro da empresa. A validaÃ§Ã£o de comÃ©rcio nÃ£o comprova prontidÃ£o para atendimento de clÃ­nicas ou outros prestadores de serviÃ§os.

## Goals

- [ ] Configurar uma empresa como vendedora exclusiva de produtos ou serviÃ§os desde o signup.
- [ ] Concluir agendamento por texto ou voz, escolhendo profissional, data e horÃ¡rio reais.
- [ ] Aplicar a polÃ­tica de bloqueio e pagamento configurada pela empresa, sem duplicar vagas ou pagamentos.
- [ ] Operar atendimento humano pelo mÃ³dulo WhatsApp, com pausa e retomada persistidas da IA.
- [ ] Alimentar um RAG genÃ©rico com os dados pÃºblicos cadastrados e medir respostas por fontes e resultados verificÃ¡veis.
- [ ] Gerenciar profissionais, categorias, disponibilidade e agendamentos manuais em Atendimento, exclusivo para empresas de serviÃ§os.
- [ ] Exibir KPIs de serviÃ§o com estados operacionais e financeiros separados, preservando o painel de empresas de produtos.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Empresa vender produtos e serviÃ§os simultaneamente | UsuÃ¡rio escolheu modalidade exclusiva. |
| Agenda externa, Google Calendar ou prontuÃ¡rio eletrÃ´nico | UsuÃ¡rio escolheu agenda interna do Zyon. |
| Cancelamento/remarcaÃ§Ã£o automÃ¡ticos pelo comprador | Piloto usa a central humana e a polÃ­tica publicada. |
| DiagnÃ³stico, prescriÃ§Ã£o e decisÃ£o autÃ´noma de tratamento | O atendimento informativo nÃ£o substitui atuaÃ§Ã£o profissional. |
| ProntuÃ¡rios, exames e conversas privadas como corpus pÃºblico | O RAG pÃºblico usa informaÃ§Ãµes pÃºblicas do negÃ³cio. |
| Central separada para editar conhecimento do RAG | O usuÃ¡rio determinou uso dos cadastros normais da empresa. |
| PublicaÃ§Ã£o desta feature ou criaÃ§Ã£o de cadastros clÃ­nicos em produÃ§Ã£o | Requer aÃ§Ã£o remota explicitamente autorizada, apÃ³s a implementaÃ§Ã£o aprovada e verificada. |
| Alterar os pedidos pagos e o estoque existentes da Athom | A validaÃ§Ã£o deve preservar o estado real atual. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Modalidade comercial | Produtos ou serviÃ§os, exclusivamente | User: "Escolha exclusiva: produtos ou serviÃ§os" | y |
| Agenda | Interna, com vÃ¡rios profissionais | User: "VÃ¡rios profissionais com agenda interna do Zyon" | y |
| Reserva temporÃ¡ria e pagamento | Configurados pela prÃ³pria empresa | User: "configura tempo de bloqueio se bloqueia ou nao se pagamento sera automatizado ou na hora" | y |
| Sem bloqueio | Desativa somente reserva provisÃ³ria; confirmado ocupa a vaga | User: "Sem bloqueio temporÃ¡rio; agendamento confirmado ocupa a vaga (recomendado)" | y |
| Cancelar/remarcar | Atendimento humano conforme polÃ­tica cadastrada | User escolheu "opÃ§Ã£o 1" para solicitaÃ§Ã£o Ã  central humana | y |
| Central | Dentro do mÃ³dulo WhatsApp, na mesma conversa, com IA pausada | User: "devemos criar essa central no modulo de whatsapp" | y |
| Retorno da IA | AutomÃ¡tico ao encerrar o atendimento humano | User: "Automaticamente quando o humano encerrar" | y |
| RAG | GenÃ©rico, alimentado pelo cadastro e pelas alteraÃ§Ãµes da empresa | User: "todo cadastro vai gerando dados para o rag e alimentando" | y |
| Campo de apresentaÃ§Ã£o | "Sobre a empresa" em Dados da empresa | SolicitaÃ§Ã£o explÃ­cita do usuÃ¡rio; reaproveitar armazenamento canÃ´nico existente | y |
| Conversas humanas | Aba dentro de WhatsApp | User: "uma tab dentro de whatsapp ja e o suficiente" | y |
| GestÃ£o de serviÃ§os | Nova pÃ¡gina Atendimento somente para serviÃ§os | User: "pagina nova de atendimento mas so para emrpesas que vendem serviÃ§os" | y |
| Dashboard | KPIs ajustados Ã  modalidade | User: "kpis e metricas do dashboard devem se ajustar para este tipo de negocio" | y |
| Isolamento tÃ©cnico | Reaproveitar autenticaÃ§Ã£o, tenant, inbox, pagamentos e fontes canÃ´nicas existentes | PadrÃ£o do repositÃ³rio; a feature nÃ£o concede acesso por texto do usuÃ¡rio | y |
| Dados para teste | Fatos e identidades sintÃ©ticos rotulados; nenhum paciente real | Permite testes locais sem criar oferta clÃ­nica real na Athom | y |

**Open questions:** none for specification review. Cadastros, conteÃºdo aprovado e polÃ­tica real de cada empresa sÃ£o insumos de ativaÃ§Ã£o, nÃ£o respostas inventadas pelo sistema.

## User Stories

### P1: Business capability and onboarding

**User Story:** Como empresa, quero informar o que vendo e configurar meu atendimento para mostrar somente os recursos aplicÃ¡veis ao meu negÃ³cio.

**Acceptance Criteria:**

1. WHEN a empresa conclui o signup THEN the system SHALL persistir exatamente uma modalidade comercial, `products` ou `services`, selecionada em "O que sua empresa vende?". [ONB-01]
2. WHILE a modalidade Ã© `products` the system SHALL ocultar as aÃ§Ãµes de agendamento e recusar tentativas de executÃ¡-las pela API, preservando a navegaÃ§Ã£o atual de produtos. [ONB-02]
3. WHEN uma empresa de serviÃ§os configura atendimento THEN the system SHALL exigir a escolha explÃ­cita de bloqueio temporÃ¡rio, duraÃ§Ã£o positiva em minutos quando habilitado, e pagamento `online` ou `at_attendance`. [ONB-03]
4. IF uma troca de modalidade conflita com ofertas ativas ou agendamentos existentes THEN the system SHALL recusar a troca com a indicaÃ§Ã£o do conflito, sem excluir nem converter registros. [ONB-04]
5. WHEN a empresa edita Dados da empresa THEN the system SHALL permitir salvar e reabrir o campo "Sobre a empresa" usando a descriÃ§Ã£o pÃºblica canÃ´nica, sem duplicar seu armazenamento. [ONB-05]

**Independent Test:** Signup em cada modalidade; leitura apÃ³s novo login; tentativa direta de agendar em empresa de produtos; configuraÃ§Ã£o invÃ¡lida; troca de modalidade com registros ativos.

### P1: Professionals, dates and slots

**User Story:** Como comprador, quero escolher um profissional e ver datas e horÃ¡rios disponÃ­veis para reservar o serviÃ§o certo.

**Acceptance Criteria:**

1. WHEN a empresa publica um serviÃ§o agendÃ¡vel THEN the system SHALL vincular sua duraÃ§Ã£o e profissionais a recursos de agenda da prÃ³pria empresa. [AGENDA-01]
2. WHEN o comprador abre um serviÃ§o THEN the system SHALL apresentar datas com disponibilidade atual para o serviÃ§o e profissional selecionados. [AGENDA-02]
3. WHEN o comprador escolhe uma data THEN the system SHALL mostrar somente os slots disponÃ­veis dessa data, informando inÃ­cio, duraÃ§Ã£o e fuso do atendimento. [AGENDA-03]
4. WHEN o comprador seleciona um horÃ¡rio THEN the system SHALL revalidar o slot e mostrar serviÃ§o, profissional, data, hora e valor antes da confirmaÃ§Ã£o. [AGENDA-04]
5. IF dois serviÃ§os do mesmo profissional disputam intervalos sobrepostos THEN the system SHALL permitir no mÃ¡ximo um agendamento confirmado nesse intervalo. [AGENDA-05]
6. IF a agenda estÃ¡ vazia, desatualizada ou indisponÃ­vel THEN the system SHALL informar o estado correspondente sem criar horÃ¡rio ou declarar indisponibilidade total a partir de uma falha de leitura. [AGENDA-06]
7. WHEN texto ou Ã¡udio descreve uma data ou profissional ambÃ­guo THEN the system SHALL pedir a escolha explÃ­cita entre as opÃ§Ãµes atuais antes de reservar ou cobrar. [AGENDA-07]

**Independent Test:** Dois profissionais, trÃªs serviÃ§os e duas datas; serviÃ§os diferentes com o mesmo profissional; competiÃ§Ã£o concorrente pelo mesmo intervalo; slot vencido; leitura com erro; Ã¡udio ambÃ­guo.

### P1: Booking and payment policies

**User Story:** Como empresa, quero controlar reserva provisÃ³ria e recebimento sem permitir inconsistÃªncia entre agenda, pedido e pagamento.

**Acceptance Criteria:**

1. WHERE bloqueio temporÃ¡rio estÃ¡ habilitado the system SHALL reservar provisoriamente o intervalo pelo tempo configurado, exibindo seu vencimento pelo relÃ³gio do servidor. [BOOK-01]
2. WHEN uma reserva provisÃ³ria vence ou Ã© abandonada THEN the system SHALL liberar somente o bloqueio provisÃ³rio correspondente, sem liberar um agendamento jÃ¡ confirmado. [BOOK-02]
3. WHERE bloqueio temporÃ¡rio estÃ¡ desabilitado the system SHALL revalidar a capacidade no ato da confirmaÃ§Ã£o, sem garantir a vaga durante a seleÃ§Ã£o. [BOOK-03]
4. WHERE pagamento Ã© `at_attendance` the system SHALL confirmar o agendamento atomicamente com a ocupaÃ§Ã£o do horÃ¡rio e registrar pagamento pendente, sem criar cobranÃ§a antecipada. [BOOK-04]
5. WHERE pagamento Ã© `online` the system SHALL confirmar o agendamento somente apÃ³s a confirmaÃ§Ã£o financeira do provedor e a aquisiÃ§Ã£o vÃ¡lida da vaga. [BOOK-05]
6. IF pagamento Ã© aprovado apÃ³s a vaga se tornar indisponÃ­vel THEN the system SHALL manter o pagamento real registrado e sinalizar regularizaÃ§Ã£o para a empresa, sem confirmar vaga inexistente nem cobrar novamente. [BOOK-06]
7. WHEN a empresa registra recebimento no atendimento THEN the system SHALL guardar valor, forma, operador e momento da quitaÃ§Ã£o, sem apresentar esse registro como confirmaÃ§Ã£o de um provedor externo. [BOOK-07]
8. IF mensagem, confirmaÃ§Ã£o ou webhook Ã© repetido THEN the system SHALL manter um Ãºnico agendamento e uma Ãºnica aplicaÃ§Ã£o do mesmo evento financeiro. [BOOK-08]
9. WHEN o comprador solicita cancelar ou remarcar THEN the system SHALL encaminhar Ã  central humana com o vÃ­nculo do agendamento e a polÃ­tica publicada da empresa. [BOOK-09]
10. WHEN uma reserva de serviÃ§o Ã© concluÃ­da THEN the system SHALL emitir confirmaÃ§Ã£o com serviÃ§o, profissional, data, hora, fuso e situaÃ§Ã£o financeira, sem tratÃ¡-la como produto enviado ou baixar estoque fÃ­sico. [BOOK-10]

**Independent Test:** Quatro combinaÃ§Ãµes de bloqueio/pagamento; expiraÃ§Ã£o por relÃ³gio controlado; duas confirmaÃ§Ãµes concorrentes; pagamento tardio; webhook repetido; quitaÃ§Ã£o local auditada; evento de confirmaÃ§Ã£o e ausÃªncia de saÃ­da de estoque fÃ­sico.

### P1: WhatsApp human support center

**User Story:** Como comprador, quero pedir um atendente na mesma conversa; como empresa, quero assumir, responder e encerrar pelo mÃ³dulo WhatsApp.

**Acceptance Criteria:**

1. WHEN o comprador abre o Menu principal THEN the system SHALL apresentar a opÃ§Ã£o "Falar com atendente" sem ultrapassar o limite de opÃ§Ãµes de cada controle nativo. [HUM-01]
2. WHEN o comprador pede atendente por botÃ£o, texto ou voz, inclusive durante o checkout, THEN the system SHALL abrir ou reutilizar um atendimento vinculado Ã  empresa e conversa autenticadas antes de confirmar o encaminhamento. [HUM-02]
3. WHILE o atendimento estÃ¡ aguardando ou sob atendimento humano the system SHALL pausar as respostas automÃ¡ticas da IA sem perder carrinho, agendamento ou pagamento. [HUM-03]
4. WHEN operador autorizado acessa a central do mÃ³dulo WhatsApp THEN the system SHALL permitir consultar a fila, assumir uma conversa, responder e encerrar somente atendimentos de sua empresa. [HUM-04]
5. WHEN operador envia resposta THEN the system SHALL persistir a mensagem e seu estado de entrega na conversa original, sem considerar aceite do provedor como leitura pelo comprador. [HUM-05]
6. WHEN operador encerra o atendimento THEN the system SHALL restaurar o modo IA e informar a devoluÃ§Ã£o uma Ãºnica vez, mesmo com eventos repetidos. [HUM-06]
7. IF a fila, a entrega ou a equipe estÃ¡ indisponÃ­vel THEN the system SHALL informar o estado real, sem prometer atendimento imediato ou resposta jÃ¡ enviada. [HUM-07]
8. WHEN o operador abre o mÃ³dulo WhatsApp THEN the system SHALL oferecer a aba "Conversas" para operar o atendimento humano existente sem exigir uma central separada para o RAG. [HUM-08]

**Independent Test:** Pedido durante coleta de dados; fila e tomada de conversa; resposta real na mesma thread; operador de outro tenant negado; fechamento duplicado; geraÃ§Ã£o de IA em andamento ao iniciar handoff.

### P1: Automatic generic business RAG

**User Story:** Como empresa de qualquer ramo de serviÃ§os, quero que meus cadastros publicados alimentem o conhecimento do assistente sem manutenÃ§Ã£o manual de seeds.

**Acceptance Criteria:**

1. WHEN cadastro pÃºblico da empresa, profissional, serviÃ§o, horÃ¡rio de funcionamento, FAQ ou polÃ­tica Ã© publicado ou alterado THEN the system SHALL registrar atualizaÃ§Ã£o idempotente da projeÃ§Ã£o de conhecimento com tenant, origem e versÃ£o. [RAG-01]
2. WHEN uma fonte Ã© retirada ou despublicada THEN the system SHALL impedir seu uso como evidÃªncia ativa e retirar sua projeÃ§Ã£o, sem recuperar texto antigo como resposta atual. [RAG-02]
3. IF embeddings ou grafo estÃ£o indisponÃ­veis THEN the system SHALL conservar o cadastro canÃ´nico e registrar a indexaÃ§Ã£o pendente para nova tentativa, sem desfazer o cadastro nem inventar uma resposta. [RAG-03]
4. WHEN o assistente compÃµe uma resposta factual THEN the system SHALL usar fontes pÃºblicas da empresa autenticada e conservar as referÃªncias de origem e versÃ£o para auditoria. [RAG-04]
5. WHEN a pergunta combina Ã¡rea de atuaÃ§Ã£o, serviÃ§o, profissional, preÃ§o e disponibilidade THEN the system SHALL combinar recuperaÃ§Ã£o semÃ¢ntica com leituras canÃ´nicas de serviÃ§o, preÃ§o e agenda, sem extrair confirmaÃ§Ã£o financeira ou vaga de um embedding. [RAG-05]
6. IF nÃ£o hÃ¡ fonte suficiente ou hÃ¡ conflito entre fontes THEN the system SHALL explicitar a lacuna e pedir esclarecimento ou encaminhar ao humano, sem atribuir Ã  empresa um serviÃ§o, credencial ou polÃ­tica nÃ£o publicada. [RAG-06]
7. The system SHALL excluir credenciais, prontuÃ¡rios, dados pessoais privados e conversas de clientes do corpus pÃºblico e das respostas a outros compradores. [RAG-07]
8. WHILE a recuperaÃ§Ã£o usa Neo4j Community the system SHALL executar somente consultas parametrizadas e aprovadas no gateway privado, sem executar Cypher livre fornecido pelo modelo ou comprador. [RAG-08]
9. WHEN um cenÃ¡rio de segmento regulado exige diagnÃ³stico, prescriÃ§Ã£o ou decisÃ£o profissional individual THEN the system SHALL encaminhar ao profissional e limitar a resposta informativa ao conteÃºdo publicado aplicÃ¡vel. [RAG-09]
10. WHEN uma nova empresa de um ramo de serviÃ§os Ã© cadastrada THEN the system SHALL aplicar o mesmo fluxo de ingestÃ£o e consulta sem FAQ, nomes ou especialidades mÃ©dicos hardcoded. [RAG-10]
11. WHEN a empresa mantÃ©m apresentaÃ§Ã£o, polÃ­ticas, profissionais e horÃ¡rios em seus cadastros normais THEN the system SHALL alimentar o contexto desses registros sem exigir duplicaÃ§Ã£o de conteÃºdo em uma central de RAG. [RAG-11]

**Independent Test:** Neurologia, salÃ£o e consultoria com conteÃºdo sintÃ©tico; atualizaÃ§Ãµes e remoÃ§Ãµes; contradiÃ§Ãµes; falha de grafo; fonte de outro tenant; dados privados; prompt injection; consultas compostas com agenda operacional.

### P1: Service management page

**User Story:** Como empresa de serviÃ§os, quero organizar minha equipe, categorias e agenda e registrar agendamentos manuais no mesmo domÃ­nio usado pelo comprador.

**Acceptance Criteria:**

1. WHEN uma empresa de serviÃ§os abre a navegaÃ§Ã£o administrativa THEN the system SHALL oferecer a pÃ¡gina "Atendimento", negando sua gestÃ£o a empresas de produtos tambÃ©m nas rotas da API. [ATEND-01]
2. WHEN operador autorizado mantÃ©m profissionais THEN the system SHALL permitir cadastrar, editar e desativar profissionais da prÃ³pria empresa, preservando o histÃ³rico de agendamentos. [ATEND-02]
3. WHEN operador mantÃ©m categorias de atendimento THEN the system SHALL vincular categorias e serviÃ§os publicados sem transformar categoria em recurso de capacidade. [ATEND-03]
4. WHEN a empresa publica disponibilidade de um profissional THEN the system SHALL considerar grade, duraÃ§Ã£o do serviÃ§o, fuso e indisponibilidades na mesma leitura usada pelo WhatsApp, storefront e agendamento manual. [ATEND-04]
5. WHEN operador cria um horÃ¡rio avulso THEN the system SHALL validÃ¡-lo no fuso do profissional e impedir sobreposiÃ§Ã£o com intervalos confirmados ou bloqueados. [ATEND-05]
6. WHEN operador cria um agendamento manual THEN the system SHALL aplicar a mesma capacidade, polÃ­tica financeira, identidade de cliente e idempotÃªncia usadas no fluxo de autoatendimento. [ATEND-06]
7. WHEN operador inicia, conclui ou registra ausÃªncia de um atendimento THEN the system SHALL persistir a transiÃ§Ã£o operacional explÃ­cita sem inferir quitaÃ§Ã£o financeira ou comparecimento pelo pagamento. [ATEND-07]
8. IF um operador tenta gerir profissional, categoria, grade ou agendamento de outra empresa THEN the system SHALL recusar a operaÃ§Ã£o sem expor o registro solicitado. [ATEND-08]
9. WHEN operador bloqueia uma indisponibilidade THEN the system SHALL retirar o intervalo da oferta pÃºblica sem cancelar ou sobrepor silenciosamente agendamentos confirmados. [ATEND-09]
10. WHEN operador agenda fora da grade regular THEN the system SHALL permitir a criaÃ§Ã£o explÃ­cita de horÃ¡rio avulso na mesma operaÃ§Ã£o, sem sobreposiÃ§Ã£o e sob a polÃ­tica de pagamento vigente. [ATEND-10]

**Independent Test:** Cadastro e desativaÃ§Ã£o de profissional com histÃ³rico; categoria com serviÃ§os; mesma agenda nos trÃªs canais; agendamento manual em disputa com comprador; aÃ§Ãµes operacionais com pagamento local pendente; acesso de outro tenant.

### P1: Service dashboard metrics

**User Story:** Como empresa de serviÃ§os, quero ver minha operaÃ§Ã£o e meus recebimentos por indicadores adequados, sem confundir agendamento com venda paga ou atendimento realizado.

**Acceptance Criteria:**

1. WHEN a empresa abre o dashboard THEN the system SHALL selecionar os indicadores da modalidade comercial persistida, mantendo os indicadores atuais para produtos. [KPI-01]
2. WHEN o painel contabiliza agendamentos do perÃ­odo THEN the system SHALL contar cada agendamento uma vez por estado operacional, usando o inÃ­cio agendado no fuso da empresa como coorte declarada. [KPI-02]
3. WHEN o painel calcula ocupaÃ§Ã£o THEN the system SHALL dividir minutos ocupados confirmados pelos minutos ofertados Ãºnicos por profissional no perÃ­odo, sem duplicar capacidade de serviÃ§os que compartilham esse profissional. [KPI-03]
4. WHEN o painel mostra valores de serviÃ§os THEN the system SHALL separar valor agendado, valor a receber e recebimento confirmado, usando evidÃªncias financeiras prÃ³prias de pagamento online ou registro local. [KPI-04]
5. WHEN operador filtra perÃ­odo, profissional ou categoria THEN the system SHALL aplicar os mesmos limites de tenant e perÃ­odo aos totais e detalhamentos retornados pela API. [KPI-05]
6. WHEN o painel mostra concluÃ­dos ou ausÃªncias THEN the system SHALL usar somente os estados operacionais registrados, sem inferir conclusÃ£o por pagamento ou ausÃªncia pelo decurso do horÃ¡rio. [KPI-06]
7. IF uma leitura de mÃ©tricas falha ou o denominador de uma taxa nÃ£o existe THEN the system SHALL distinguir dados indisponÃ­veis de zero e mostrar taxa nÃ£o calculÃ¡vel sem fabricar percentuais. [KPI-07]

**Independent Test:** Agenda sintÃ©tica conhecida com dois profissionais, serviÃ§os compartilhados, cancelamentos, ausÃªncia, concluÃ­dos nÃ£o pagos e pagamentos sem comparecimento; fronteira de fuso; filtros; indisponibilidade; painel de produtos inalterado.

### P1: Preserve approved product journeys

**User Story:** Como empresa de produtos, quero continuar usando os fluxos jÃ¡ aprovados enquanto empresas de serviÃ§os recebem uma jornada prÃ³pria.

**Acceptance Criteria:**

1. WHEN uma empresa usa WhatsApp ou storefront THEN the system SHALL selecionar a jornada pela modalidade canÃ´nica da empresa, sem aplicar polÃ­ticas de agenda, pagamento no atendimento ou controles de profissional Ã  compra de produtos. [REG-01]
2. WHEN a nova jornada de serviÃ§os Ã© validada THEN the system SHALL comprovar nos dois canais a preservaÃ§Ã£o de catÃ¡logo, busca e comparaÃ§Ã£o, detalhes e avaliaÃ§Ãµes, carrinho e cross-sell, identidade e endereÃ§o, frete e checkout, incluindo Pix, cartÃ£o e troca do mÃ©todo de pagamento de produtos. [REG-02]
3. WHEN pagamentos de produtos e agendamentos de serviÃ§os sÃ£o processados na mesma revisÃ£o THEN the system SHALL preservar totais, recibos, transiÃ§Ãµes de pedido, eventos e baixa de estoque fÃ­sico de produtos, impedindo que eventos de serviÃ§o produzam envio ou saÃ­da de estoque fÃ­sico. [REG-03]
4. WHEN a feature Ã© migrada, habilitada ou desabilitada THEN the system SHALL preservar empresas e registros existentes, manter serviÃ§os novos desabilitados para empresas de produtos e conservar o processamento dos agendamentos e pagamentos jÃ¡ iniciados. [REG-04]

**Independent Test:** Dois tenants sintÃ©ticos, um de cada modalidade, no WhatsApp e storefront; matriz de comÃ©rcio aprovada antes/depois; migraÃ§Ã£o sobre fixture de dados anteriores; desativaÃ§Ã£o de novas reservas com pagamentos pendentes e agendamentos confirmados preservados.

### P1: Private human-support alerts

**User Story:** Como empresa, quero receber um aviso de pedido de atendimento humano no WhatsApp da equipe, mantendo o cliente na conversa original.

**Acceptance Criteria:**

1. WHEN um operador autorizado configura ou remove o telefone de fallback em Atendimento/Suporte THEN the system SHALL persistir um destinatário privado da própria empresa, independente da modalidade, sem publicá-lo no storefront/RAG nem modificar o conteúdo ou a versão pública do FAQ. [HUM-09]
2. WHEN um novo atendimento humano é confirmado com telefone de fallback configurado THEN the system SHALL enfileirar uma única notificação de WhatsApp por atendimento/época com link autenticado para a conversa, mantendo o cliente no canal original e expondo falha ou resultado incerto sem afirmar entrega nem duplicar envio incerto. [HUM-10]

**Independent Test:** Salvar e limpar telefone pela UI/API; comparar FAQ e fontes públicas antes/depois; pedido humano por texto/voz/tool gera um atendimento e um alerta; rollback, duplicação, indisponibilidade e resultado incerto mantêm os estados verdadeiros. O transporte de teste é local.

### P1: Service appointments board

**User Story:** Como prestador de serviços, quero acompanhar os agendamentos em Kanban ou lista sem misturá-los com pedidos de produtos ou configurações da agenda.

**Acceptance Criteria:**

1. WHEN um operador autorizado abre Agendamentos THEN the system SHALL oferecer Kanban e lista da mesma consulta canônica de ServiceAppointment, com os seis estados operacionais, filtros coerentes de período/profissional/serviço e estado financeiro separado, preservando versão e registro anterior quando uma ação falha. [ATEND-11]
2. WHEN uma empresa de serviços acessa a navegação principal THEN the system SHALL apresentar Agendamentos no lugar da entrada principal de Pedidos e conservar Atendimento para gestão, enquanto empresas de produtos preservam Pedidos e não acessam Agendamentos por menu ou URL, sem apagar o histórico de pedidos de qualquer modalidade. [ATEND-12]

**Independent Test:** Mesmos IDs/contagem nos dois modos de visualização, seis estados e pagamentos separados, filtros/fuso, ações permitidas e conflito versionado, navegação/URL nas duas modalidades, histórico preservado e capturas locais desktop/mobile.

### P1: Catalog creation matches the selected business mode

**User story:** A empresa encontra o cadastro correspondente à modalidade que escolheu, com os mesmos controles visuais e a autoridade de catálogo existentes.

1. WHILE a modalidade canônica da empresa é `products`, WHEN o operador abre o cadastro THEN the system SHALL oferecer apenas os tipos `physical`, `digital` e `food`, sem a opção de cadastrar `service`, preservando a validação da API e os registros históricos. [CAT-01]
2. WHILE a modalidade canônica da empresa é `services`, WHEN o operador abre ou limpa o cadastro THEN the system SHALL apresentar o fluxo "Novo serviço" com tipo `service`, conservando esse tipo no envio e sem converter silenciosamente um registro já carregado de outra modalidade. [CAT-02]
3. WHEN o operador altera uma configuração booleana no cadastro de produto ou serviço THEN the system SHALL apresentar um toggle acessível com nome e estado, conservando o valor, validação e persistência existentes. [CAT-03]
4. WHILE a modalidade canônica é `services`, WHEN o operador vincula profissionais a um serviço salvo THEN the system SHALL permitir selecionar profissionais da própria empresa, preservar os outros serviços de cada profissional e apresentar conflitos ou falhas sem duplicar o serviço nem declarar vínculos não persistidos. [CAT-04]
5. WHERE o plano atual não habilita regras avançadas, WHEN o operador abre o cadastro salvo THEN the system SHALL manter o bloqueio visual existente e não consultar regras avançadas, conservando o acesso e o carregamento para planos habilitados sem aplicar respostas antigas após mudança de contexto. [CAT-05]

**Independent Test:** Abrir o catálogo com empresas sintéticas de produtos e serviços; clicar no cadastro; verificar opções, padrão/reset e payload; alternar contexto durante edição; demonstrar que tipos inválidos continuam recusados pela guarda existente. Capturar as duas modalidades no navegador local em desktop/mobile. Esses testes não alteram os fluxos de compra existentes.

### P1: Evidence and acceptance

**User Story:** Como responsÃ¡vel pelo produto, quero comprovar UI, reservas, pagamentos e conhecimento antes de liberar uma empresa real.

**Acceptance Criteria:**

1. WHEN a feature Ã© validada THEN the system SHALL produzir uma matriz que relacione cada critÃ©rio ao comando e Ã  evidÃªncia de seu resultado no mesmo HEAD. [QA-01]
2. WHEN o fluxo visual Ã© demonstrado THEN the system SHALL fornecer prints das telas e conversas correspondentes, marcando separadamente prÃ©vias locais e capturas reais. [QA-02]
3. WHEN os testes financeiros e de concorrÃªncia sÃ£o executados THEN the system SHALL comprovar unicidade de reserva, estado financeiro verdadeiro e isolamento de tenant, sem depender apenas da mensagem da IA. [QA-03]
4. WHEN o RAG Ã© avaliado THEN the system SHALL medir respostas apoiadas por fonte, tratamento de ausÃªncia/contradiÃ§Ã£o e uso correto de ferramentas em trÃªs ramos, exigindo aprovaÃ§Ã£o de todos os casos crÃ­ticos antes da ativaÃ§Ã£o. [QA-04]

**Independent Test:** RelatÃ³rio de provas, mutaÃ§Ãµes independentes, revisÃ£o de telas e UAT por texto/voz no WhatsApp e storefront, com revisÃ£o profissional do corpus quando aplicÃ¡vel.

### P0: Verified buyer login prerequisite

**User Story:** Como comprador, quero que somente a senha correta permita acessar meus dados e agendamentos.

**Acceptance Criteria:**

1. IF buyer password verification returns valid:false THEN the system SHALL reject login with HTTP401 invalid_credentials, issue no buyer credential and preserve the account, while accepting the correct password through the existing authenticated buyer guard. [AUTH-01]

**Independent Test:** Real PasswordHasher and JWT signer; wrong password, malformed hashes, absent and phone-only accounts; correct normalized email and password; forged JWT; actual local HTTP/SQL and unchanged product journeys.

## Edge Cases

- IF um ID de profissional, empresa ou horÃ¡rio pertence a outro tenant THEN the system SHALL rejeitar a aÃ§Ã£o sem expor dados desse tenant. [EDGE-01]
- IF uma polÃ­tica muda durante uma reserva THEN the system SHALL exigir uma nova confirmaÃ§Ã£o da condiÃ§Ã£o comercial atual antes de criar cobranÃ§a ou reserva final. [EDGE-02]
- IF a mÃ­dia de confirmaÃ§Ã£o falha THEN the system SHALL preservar a entrega do texto e o estado canÃ´nico jÃ¡ confirmado. [EDGE-03]
- IF um operador assume enquanto uma resposta da IA estÃ¡ em processamento THEN the system SHALL impedir o envio dessa resposta automÃ¡tica apÃ³s a mudanÃ§a de modo. [EDGE-04]
- IF a fonte contÃ©m instruÃ§Ãµes para executar ferramentas ou revelar dados THEN the system SHALL tratÃ¡-la somente como conteÃºdo recuperado, sem conceder autoridade operacional. [EDGE-05]

### P1: Public service names in company data

**User Story:** Como empresa de serviÃ§os, quero cadastrar uma lista simples do que ofereÃ§o em Dados da empresa para apresentar meu negÃ³cio e dar contexto ao assistente.

**Acceptance Criteria:**

1. WHILE a modalidade canÃ´nica Ã© `services` the system SHALL permitir adicionar pelo botÃ£o "+", editar, remover, salvar e reabrir uma lista de nomes de serviÃ§os em Dados da empresa e usar somente os nomes pÃºblicos salvos como contexto do RAG, ocultando e recusando sua ediÃ§Ã£o para empresas de produtos e retirando esse contexto quando a modalidade mudar para produtos. [ONB-06]

**Independent Test:** Na empresa de serviÃ§os adicionar dois nomes, editar/remover, salvar e recarregar com persistÃªncia real; provar os nomes na fonte pÃºblica atual, omissÃ£o preservando dados e lista vazia limpando contexto. Na empresa de produtos nÃ£o mostrar o controle, recusar escrita direta e impedir uso de nomes histÃ³ricos pelo RAG. A lista nÃ£o cria preÃ§o, duraÃ§Ã£o, disponibilidade ou oferta comercial.

## Requirement Traceability

| Requirement ID | Story | Tasks | Status |
| --- | --- | --- | --- |
| ONB-01 | Capability selection | T4, T8, T9, T10 | Implemented locally |
| ONB-02 | Conditional navigation and API | T7, T9, T10, T17, T19, T94 | In Progress (T17 and T19 complete) |
| ONB-03 | Merchant appointment policy | T4, T7, T11, T27, T81 | In Progress (T4, T7, T11 and T27 complete) |
| ONB-04 | Non-destructive mode change | T5, T7, T12, T17 | In Progress (T17 complete) |
| ONB-05 | About field in company data | T13, T14, T15, T16 | Implemented locally |
| ONB-06 | Service-name list in company data, services only | T96, T97, T63, T72 | Complete locally (T96/T97/T63/T72); final feature proof pending |
| AGENDA-01 | Professional resources | T4, T18, T20, T21, T76, T106 | In Progress (T18, T20 and T21 complete) |
| AGENDA-02 | Dates | T23, T24, T43, T44, T45 | In Progress (T23 and T24 complete) |
| AGENDA-03 | Slots | T23, T24, T43, T44, T45 | In Progress (T23 and T24 complete) |
| AGENDA-04 | Selection summary | T28, T40, T42, T43, T45, T46 | Pending |
| AGENDA-05 | Shared capacity | T23, T26, T34 | In Progress (T23 and T26 complete) |
| AGENDA-06 | Empty/error states | T23, T24, T44 | In Progress (T23 and T24 complete) |
| AGENDA-07 | Text/voice ambiguity | T42, T46, T93 | Pending |
| BOOK-01 | Provisional hold | T27 | Implemented (T27; final proof pending) |
| BOOK-02 | Expiry | T27 | Implemented (T27; final proof pending) |
| BOOK-03 | No provisional hold | T26, T27, T28, T29, T40 | In Progress (T26 and T27 complete) |
| BOOK-04 | Pay at attendance | T30, T40, T46 | In Progress (T30 complete) |
| BOOK-05 | Pay online | T29, T35, T40 | Pending |
| BOOK-06 | Late payment | T36 | Pending |
| BOOK-07 | On-site receipt | T4, T37, T41, T80 | Pending |
| BOOK-08 | Idempotency | T26, T30, T31, T32, T33, T35, T36, T37, T38, T84 | In Progress (T26/T30/T31/T32 locally complete; later financial commands/final proof pending) |
| BOOK-09 | Change requests | T33, T34, T41, T49, T80 | In Progress (T49 trusted intake/reference complete; operations/UI pending) |
| BOOK-10 | Confirmation and inventory | T35, T38, T39 | Pending |
| HUM-01 | Fixed menu entry | T57 | Pending |
| HUM-02 | Handoff intake | T49, T50, T57 | In Progress (T49 intake and T50 router complete; menu pending) |
| HUM-03 | AI pause | T4, T48, T49, T50, T51, T109 | Complete (LOCAL; T4/T48-T51 and T109 locally gated; final feature verification pending) |
| HUM-04 | WhatsApp center | T52, T53, T58, T59, T60, T61, T62 | In Progress (T52 exact claim,T53send,T59permissionprimitives complete; queue/UI pending) |
| HUM-05 | Original conversation delivery | T53, T54, T55, T60, T61 | In Progress (T53 queue, T54 local transport and T55 authenticated local receipt processing complete; T60/T61 console and final verification pending) |
| HUM-06 | Automatic AI resume | T56, T61 | In Progress (T56 canonical closure/automatic resume locally complete; T61 operator UI and final proof pending) |
| HUM-07 | Unavailable team/provider | T54, T55, T58, T109 | In Progress (T54/T55/T109 locally complete; T58 team notices pending) |
| HUM-08 | Conversations tab inside WhatsApp | T58, T59, T60, T62, T82 | In Progress (T59permissionprimitives complete; tab/route wiring pending) |
| RAG-01 | Automatic indexing | T4, T21, T63, T64, T65, T66, T104 | Implemented locally including T104 bounded-write repair; final proof pending |
| RAG-02 | Retirement | T65, T67, T68, T104 | Implemented locally including T104 bounded-write repair; final proofs pending |
| RAG-03 | Retry and source durability | T64, T66, T67, T104 | Implemented locally including T104 bounded-write repair; final proofs pending |
| RAG-04 | Source provenance | T66, T68, T69 | Implemented locally (T66/T68/T69 complete; final integrated proof pending) |
| RAG-05 | Compound live queries | T70, T71 | Complete locally at T70/T71 Full; current facts and final fence proved, final verification pending |
| RAG-06 | Insufficient/conflicting evidence | T68, T71 | Complete locally at T68/T71 Full; missing/conflicting/stale sources refuse, final verification pending |
| RAG-07 | Public/private isolation | T6, T63, T68, T69 | Implemented locally (T6/T63/T68/T69 complete; final integrated proof pending) |
| RAG-08 | Controlled Cypher | T2, T70 | Implemented locally; final integrated proof pending |
| RAG-09 | Professional boundary | T71, T72 | Complete locally (T71/T72 scripted composition and professional boundary); provider-quality and final verification pending |
| RAG-10 | Generic onboarding | T63, T67, T71, T72 | Complete locally (T63/T67/T71/T72, three-business scored fixtures); final verification pending |
| RAG-11 | Existing forms feed context | T13, T14, T15, T63, T64, T65 | Pending |
| ATEND-01 | Service-only management | T41, T47, T73, T74, T75, T82, T83 | In Progress (T73 typed client and T74 view-state complete; management route and UI pending) |
| ATEND-02 | Professional administration | T18, T19, T76, T106 | In Progress (T18 and T19 complete) |
| ATEND-03 | Service categories | T20, T77 | In Progress (T20 complete) |
| ATEND-04 | Shared availability | T21, T23, T24, T25, T78 | In Progress (T21, T23, T24 and T25 complete) |
| ATEND-05 | One-off times | T22, T25, T78 | In Progress (T22 and T25 complete) |
| ATEND-06 | Manual appointments | T31, T41, T74, T79 | In Progress (T31 canonical command locally complete; API aggregation and UI pending) |
| ATEND-07 | Attendance lifecycle | T32, T41, T74, T80 | In Progress (T32 canonical backend locally complete; later management/UI gestures and final proof pending) |
| ATEND-08 | Management authorization | T6, T11, T19, T25, T41, T47, T52, T59, T73, T75, T83, T87 | In Progress (T19/T25backend, T59 client management primitive and T73 typed transport complete; remaining HTTP/UI pending) |
| ATEND-09 | Unavailability blocks | T22, T25, T78 | In Progress (T22 and T25 complete) |
| ATEND-10 | Explicit outside-hours appointment | T25, T31, T79 | In Progress (T25/T31 locally complete; T79 UI pending) |
| KPI-01 | Business-specific dashboard | T82, T87, T88, T89, T90, T91 | Pending |
| KPI-02 | Appointment cohort and counts | T85, T86, T89 | Pending |
| KPI-03 | Capacity occupancy | T86, T89 | Pending |
| KPI-04 | Separate financial metrics | T37, T85, T86, T89 | Pending |
| KPI-05 | Consistent filters | T85, T87, T88, T91 | Pending |
| KPI-06 | Explicit attendance evidence | T32, T85, T86, T89 | In Progress (T32 canonical operational evidence locally complete; metrics consumers/panel pending) |
| KPI-07 | Unknown and empty metrics | T86, T87, T88, T89, T91 | Pending |
| REG-01 | Separate business journeys in both channels | T7, T9, T17, T28, T43, T45, T46, T47, T62, T82, T83, T90, T91, T93 | In Progress (T17 complete) |
| REG-02 | Approved product interactions | T3, T17, T28, T29, T46, T57, T90, T93 | In Progress (T17 complete) |
| REG-03 | Physical commerce financial and stock integrity | T2, T29, T35, T38, T92, T93 | Pending |
| REG-04 | Compatible migration and safe activation | T1, T3, T5, T7, T8, T12, T17, T36, T47, T84, T94 | In Progress (T17 complete) |
| AUTH-01 | Reject invalid buyer passwords before JWT | T110 | Complete |
| QA-01 | Criteria proofs | T1, T108, T109, T95 | Pending; native collector and replay repairs do not close final feature proof |
| CAT-01 | Product-mode creation options | T98 | Complete locally;55unit+2real browser, no skips; final screen review later |
| CAT-02 | Service-mode creation and defaults | T98 | Complete locally; defaults/reset/payload/history and actual stale-mode409 proved |
| CAT-03 | Catalog boolean toggles | T105 | Pending |
| CAT-04 | Professional links in service editor | T106, T76 | Pending |
| CAT-05 | Advanced-rules UI follows existing plan entitlement | T107 | Complete LOCAL;70components +3actual browser/nativecleanup, types/lint/build, six Root-reviewed native captures; policy unchanged |
| HUM-09 | Private support fallback recipient | T99, T101 | In Progress (T99 private API/schema/persistence complete locally; T101 UI pending) |
| HUM-10 | Durable staff WhatsApp case alert | T100, T101 | Pending; channel confirmed2026-11-16 |
| ATEND-11 | Canonical appointments Kanban/list | T41, T74, T102, T103 | Pending; explicitly requested2026-11-16 |
| ATEND-12 | Service-only appointments navigation | T82, T83, T103 | Pending; explicitly requested2026-11-16 |
| QA-02 | Screenshots | T3, T16, T39, T44, T61, T75, T89, T93, T95 | Pending |
| QA-03 | Persisted state proof | T2, T5, T26, T108, T92, T95 | In Progress (T26 complete) |
| QA-04 | RAG evaluation | T72, T94, T95 | In Progress (T72 critical evaluation locally complete; T94/T95 final activation gates pending) |
| EDGE-01 | Foreign tenant identity | T6, T18, T22, T40 | In Progress (T18 and T22 complete) |
| EDGE-02 | Changed policy | T11, T28, T30, T40, T81 | In Progress (T30 complete) |
| EDGE-03 | Optional media failure | T38, T39 | Pending |
| EDGE-04 | In-flight AI response | T48, T51, T56 | Complete locally (T48/T51/T56 and actual AI dispatch/request/commit fences); final integrated verification pending |
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

- Pedido e respostas do usuÃ¡rio em 2026-11-14; transcriÃ§Ã£o de decisÃµes em context.md.
- CÃ³digo inspecionado: `apps/api/src/modules/catalog/domain/services/service-schedule.ts`, `apps/api/src/shared/bookings/service-slot-holds.service.ts`, `apps/api/src/shared/persistence/order-fulfillment.ts`.
- Suporte existente: `apps/api/src/modules/support/application/support-handoff.service.ts`, `send-ticket-message.use-case.ts`; navegaÃ§Ã£o em `whatsapp-channel/domain/ui/buyer-hub.ts`.
- RAG atual: `apps/api/src/modules/graph-rag/application/graph-projection.service.ts`, `graph-retrieval.service.ts` e `domain/graph-query.ts`.
- Signup atual inspecionado no workspace principal: `apps/dashboard/src/lib/signup-options.ts` e `apps/api/src/modules/auth/application/register-merchant.use-case.ts`; reconciliaÃ§Ã£o com a revisÃ£o publicada serÃ¡ uma verificaÃ§Ã£o do design.
- NÃ£o foram fornecidas novas capturas vinculantes para esta feature. As telas novas serÃ£o julgadas pelos resultados exigidos e pela identidade visual existente; as prÃ©vias das correÃ§Ãµes de UI sÃ£o evidÃªncia separada.
- [CFM: uso de IA como apoio e decisÃ£o profissional humana](https://portal.cfm.org.br/noticias/regras-sobre-uso-da-ia-na-medicina-entram-em-vigor-no-dia-26-de-agosto), consultado em 2026-11-14.
- [WHO: limitaÃ§Ãµes e governanÃ§a de modelos generativos em saÃºde](https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models), consultado em 2026-11-14.

## Success Criteria

- [ ] Cadastro em uma modalidade nÃ£o habilita aÃ§Ãµes da outra.
- [ ] WhatsApp e storefront preservam os fluxos de produtos aprovados enquanto serviÃ§os seguem sua jornada especÃ­fica.
- [ ] Profissional nÃ£o recebe dois agendamentos confirmados em intervalos sobrepostos.
- [ ] Quatro combinaÃ§Ãµes de bloqueio/pagamento preservam agenda e situaÃ§Ã£o financeira reais.
- [ ] Atendimento humano Ã© operado no mÃ³dulo WhatsApp e a IA retoma automaticamente ao encerrar.
- [ ] Cadastros pÃºblicos de trÃªs ramos alimentam o RAG sem seeds manuais como mecanismo normal.
- [ ] Todos os casos crÃ­ticos, os testes vinculados aos critÃ©rios e a verificaÃ§Ã£o independente passam antes de ativaÃ§Ã£o.

**T73 client wire correction approved:** 2026-11-16 - user: "Corrigir essa expectativa (recomendado)" (reply call_8c2dbee1ab4c41bb905ff23cd0ee3de7). Preserve explicit category-parent removal with the already supported parent_id:null wire alias. This corrects one SDK expectation and conditional, not product behavior or backend policy. Current focused client proof49/49; remaining requirement UI/HTTP/final gates stay pending.
