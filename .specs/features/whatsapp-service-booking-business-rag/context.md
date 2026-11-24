# WhatsApp Service Booking and Business RAG Context

**Approved test expectation (2026-11-22):** user: "Aprovar somente essa expectativa (recomendado)" (call_2aff476537a5480eb6f3aa13e73b084c). Only T43 strict provider required-field expectation appends serviceAction; patch0e13db86 applied once in Root. All existing cases and other assertions remain unchanged; P proposal stays historical. Receipt .cache/t43-approved-schema-test-20261122/receipt.json.


**Approved T103 list/Kanban presentation, 2026-11-22:** user: "Aprovar lista e Kanban" (call_4108c87ec07e416784508e1be5124ab6). Refined desktop/mobile screenshots are preview35b3cb9a, real components and synthetic DTO only. This is visual approval; route/detail/actions, backend integration, real browser/SQL/auth, builds and task acceptance remain pending. T81 visual approval remains separate.

**Approved two new native-test corrections, 2026-11-21:** user: "Aprovar os dois ajustes de testes" (call_b75f49875df344cda177e28c2c0ff07c). Apply only T41 c074d924 (foreign query403 plus tenant_mismatch_query; other invalid cases400 unchanged) and T1129d268fdd (captured original lease error code only). Preserve cases, no-write negatives, prior proposals and source freezes. No API behavior or broader test modification is authorized by these grants.

**Approved T81 visual only, 2026-11-21:** user: "Aprovar o visual" (call_aacdd232c6864cf0b1ef1195e36b0ffd). The shown desktop attendance and mobile actions PNGs belong to visual-only preview88577ce9 (real component/CSS, synthetic VM). This accepts presentation only; canonical browser/API/SQL/payment and compilation gates remain separate. No remote publication authorized.

**Approved test-only patches, 2026-11-21:** user: "Corrigir somente essa asserção" (call_370e553662004bafa083495d04f0be85) and "Aprovar os dois patches de testes" (call_0fa5c41963424f779bdfaa4690d840ad). Applied T40 patch1dbb0ac7 and T81 patchdac62bc4 once only, receipt3963cf08. The overlapping T40 grant was not applied twice. T40 now checks the established409/code/review action; T81's fake authenticated session and URL expectation now match the existing `/merchants/me/` route. All other assertions/cases and production/API code stayed exact. Original proposals/failures and P40 freeze remain preserved. The separate T41 native403 proposal is not covered by this approval and remains unapplied.

**Settled payment control, 2026-11-21:** user: "agendar sem cobrar e registrar valor para pagar no atendimento" and "Sim, começar desligado" (call_3496d7a8dc2c4819bfa1ab35a5c5a4db). Disabled means no online charge or buyer checkout at booking, while the canonical amount remains payable at attendance. Enabled means the existing online checkout. Reuse the existing `at_attendance` / `online` policy; do not add a free-service mode or a second financial authority. New service-business drafts start with online collection off. Preserve current configured businesses, explicit hold settings and accepted in-flight payment terms. User also chose "Continuar com código e testes menores" (call_b897bb6fe72645a68a216b4b04a58625); do not repeat heavy compilation attempts or resource questions without new steering/resource evidence.

**2026-11-21 / additional phone and service-payment request:** user: "o whatsapp da equipe ainda pede ddi e outra coisa habilitar e desabilitar pagamento pagamentos sao cobrados e checkout de seviço se habiilitar se nao no maximo e agendar sem pagamento nao tem problema" (call_f18e1cec04a04cd4bf91bdb0b56aa2b6). Audit all team-phone controls before assuming the user refers to the revised local T101 field. Local T101 national input passed whole UI173 and browser11; it has not been published. Add an explicit service-payment enable/disable control; disabled must allow scheduling without opening checkout. Two product details are pending in the asynchronous question: booking-only versus recording an at-attendance balance, and the initial setting for newly registered service businesses. Existing businesses retain their approved payment configuration. No dependent payment behavior is implemented before these answers.

**2026-11-21 / T101 visual feedback:** user: "nao recisa do ddi se baseia no layout do cashback e anuncios com ia e o novo estilo visual padrao do projeto" (call_975fea8c0c324845ac502b037785b911). Use a national phone field with DDD, normalize Brazil internally, and reuse the current Cashback and AI Ads design. Previous captures are technical evidence only and were not visually approved. Revised local desktop/mobile prints will be shown.

**Gathered:** 2026-11-14
**Status:** Specification and tasks approved for local implementation. Remaining task gates and final verification are in progress; no feature-completion claim.

## Feature Boundary

Planejar e validar compra de serviços pelo WhatsApp e storefront, com profissionais, datas, horários, pagamento e atendimento humano na central do módulo WhatsApp. Alimentar um RAG genérico com dados cadastrados pela empresa. Neurologia é um cenário de validação, não um domínio fixo do produto.

As correções explícitas de animação antes do texto e dez produtos por lote pertencem à manutenção da UI já autorizada. Não equivalem a autorização para implementar ou publicar o novo agendamento, a central ou o RAG genérico.

## Implementation Decisions

### Existing forms, About field and WhatsApp tab

- User: "rag nao precisa criar central ao ir cadastrando dados da empresas, politicas, sobre a empresa e um novo campo que precisa ter la onde tem dados da empresa isso tudo vai gerando contexto sabe, tambem os profissionais, horarios e etc ja as conversas do whatsapp uma tab dentro de whatsapp ja e o suficiente".
- O RAG não terá uma central própria de alimentação manual. Usará os cadastros normais, com o campo "Sobre a empresa" em Dados da empresa.
- Conversas humanas serão uma aba dentro do módulo WhatsApp, reutilizando o suporte já existente.
- Essa orientação seleciona evolução dos módulos atuais, com a organização visual esclarecida pelo usuário. Não criar serviços independentes ou um módulo central para o RAG.

### Service-only management page and dashboard

- User: "teremos uma pagina nova de atendimento mas so para emrpesas que vendem serviços dai poder criar profissionais, categorias de atendimentos, slots de horarios, horarios manuais, agendamentos manuais e kpis e metricas do dashboard devem se ajustar para este tipo de negocio".
- A nova página Atendimento é gestão operacional de serviços, exclusiva da modalidade `services`.
- Incluir cadastro de profissionais, categorias de atendimento, disponibilidade, horários avulsos e agendamento manual pela empresa.
- Painel e métricas devem se ajustar à modalidade comercial, sem misturar agendamento, atendimento realizado e recebimento.
- A página Atendimento de serviços é distinta da aba Conversas do WhatsApp. Empresas de produtos mantêm acesso ao atendimento humano no WhatsApp, mas não recebem a gestão de agenda.
- User: "use subagentes para ajudar na implementação". Delegação aceita; revisões de planejamento serão feitas agora, e trabalhadores de implementação seguirão as tarefas aprovadas.
- User confirmed manual availability: "Horários avulsos e bloqueios de indisponibilidade (recomendado)".
- User confirmed outside regular hours: "Permitir horário avulso explícito, sem sobreposição (recomendado)".
- A empresa poderá criar a exceção avulsa no próprio agendamento manual. Bloqueios administrativos não poderão sobrepor ou cancelar silenciosamente um agendamento confirmado.
- Agendamento manual não cria uma exceção financeira implícita: usa a política escolhida pela empresa, inclusive quando exige pagamento online.

### Multiple professionals and internal scheduling

- User: "Vários profissionais com agenda interna do Zyon".
- A agenda deve representar o profissional como recurso compartilhado entre seus serviços. O bloqueio atual por variante não comprova exclusão de conflitos entre serviços diferentes do mesmo profissional.
- O comprador escolhe serviço/profissional, data e horário válido, e paga pelo fluxo normal.
- A hierarquia solicitada é lista de datas, depois slots da data escolhida.

### Human support inside WhatsApp

- User: "opção 1 - devemos criar essa central no modulo de whatsapp".
- A opção escolhida foi atendimento na mesma conversa, pela central, pausando a IA.
- A central administrativa pertence ao módulo WhatsApp. A reutilização dos tickets e mensagens do módulo Support será avaliada no design; não duplicar domínio sem necessidade.
- Deve existir uma opção fixa para pedir atendimento humano. A posição final e as regras de retomada ainda serão confirmadas.

### Generic business RAG and automatic ingestion

- User: "esse rag deve ser generico para qualquer tipo de serviço entao conforme vamos criando a cadastro de uma nova empresa todo cadastro vai gerando dados para o rag e alimentando".
- Onboarding e alterações da empresa são fontes de atualização automática da base, sem seed manual como processo normal.
- Especialidades médicas são uma aplicação do modelo de serviços. O mesmo mecanismo deve atender outros ramos.
- Cadastro público da empresa, profissionais, serviços e conteúdos publicados compõem o corpus. Segredos e dados privados de clientes/pacientes não são fontes públicas do RAG.
- Preço, reserva e disponibilidade exigem leitura operacional atual; similaridade vetorial não confirma um horário ou um pagamento.

### Existing presentation decisions retained

- User: "os gifs devem vir primeiros".
- User: "mostra 10 itens porem so renderizou 3 deve renderizar todos os 10".
- Compras por voz já funcionaram no teste do usuário. Preservar o caminho de transcrição e as mesmas autoridades de carrinho/pagamento.
- Manter nome reconhecido, Menu principal, detalhes antes de adicionar, e ações próprias de cada produto.
- Continuar enviando prints, distinguindo prévias locais de capturas reais.

### Payment at attendance

- User initially: "Reservar agora e pagar no atendimento".
- Refinamento posterior: "cliente escolhe horario e nas configurações de atendimento o propria empresa configura tempo de bloqueio se bloqueia ou nao se pagamento sera automatizado ou na hora jogamos a responsabilidade".
- O produto precisa suportar as duas políticas configuradas pela empresa: pagamento online e pagamento no atendimento. A escolha inicial por pagamento local não será hardcoded para todas as empresas.
- Reserva de agenda e situação financeira precisam de estados separados.
- O comportamento existente de compra antecipada de produtos continua fora dessa mudança de política.
- Sobre registro do pagamento no local, user: "entao depende da configuração que ele escolher passamos a responsabilidade para o cliente". A empresa controla a política; o sistema não pode converter ausência de confirmação financeira em pagamento aprovado.

### Cancellation, service capability and onboarding

- User: "opção 1. porem essas opções de serviços e etc so devem ser habilitadas se o tipo de empresa for tipo de serviços dai isso deve ser preenchido no signup la ja tem o tipo de empresa mas e bom ter um toggle se vende serviços ou produto".
- Cancelamento e remarcação do piloto passam pela central humana e pela política cadastrada pela empresa.
- Signup deve registrar a capacidade comercial; controles de serviço/agendamento não aparecem em empresas que vendem apenas produtos.
- User confirmed: "Escolha exclusiva: produtos ou serviços".
- Categoria de atuação e capacidade comercial não serão confundidas com natureza jurídica.

### Merchant-owned appointment policies

- A empresa configura se haverá bloqueio temporário, sua duração e se recebe online ou no atendimento.
- O signup e as configurações não presumirão capacidade mista, por decisão explícita do usuário.
- User confirmed: "Sem bloqueio temporário; agendamento confirmado ocupa a vaga (recomendado)".
- Desativar bloqueio desativa somente a reserva provisória. Agendamentos confirmados sempre consomem a disponibilidade do profissional.
- O detalhe técnico dos limites válidos e das combinações incompatíveis será tratado no design e demonstrado nos testes, sem permitir cobrança/reserva inconsistente.

### Automatic return from human service

- User: "Automaticamente quando o humano encerrar".
- Encerrar atendimento humano restaura o modo IA. A devolução deve ser explícita na conversa e persistida; um evento repetido não pode gerar retomadas duplicadas.

## Open Product Decisions

- 2026-11-16, UI feedback after the real local catalog screenshots, user: "está sim mas trar checkbox por toggle e poder vincular um profissional a um serviço se ja nao tiver". The displayed business-mode split is accepted with two requested refinements: use the existing ToggleSwitch in the registration form and make the existing professional/service association usable from service registration/management. Inspect the already-implemented professional productIds/expectedVersion contract before adding any writer; preserve tenant/mode/role guards, other service links and honest partial-save/conflict states. Record concrete follow-up tasks before edits. Do not treat this as production approval or final approval of unimplemented Kanban/support screens.

- 2026-11-16, direct user addition: recognize natural requests for a human attendant, notify a configured fallback telephone, add a services-only appointments Kanban replacing the primary Orders entry, and remove service creation from product businesses. Implementation is local and preserves the approved product/storefront/WhatsApp journeys.
- Channel answer: user selected "WhatsApp, com link para a conversa (recomendado)". The staff recipient is private; the customer remains in the same conversation. T98 covers catalog creation; T99-T103 cover private settings, durable staff alert, settings UI, canonical appointments view model and daily board/navigation. HUM-02/T57 explicitly includes semantic paraphrases and authenticated voice using the current verified intake. No remaining channel question.

- New explicit instruction, 2026-11-14: "ah outras coisas em empresas tipo serviço adicionar quais serviços em formato de lista clica no mais e vai adicionando uma lista de serviços isso tambem e contexto para rag prossiga de onde parou".
- Clarification: user chose "Lista simples em Dados da empresa (recomendado)" and reiterated "lembrando que e só para empresas de serviços". Store a public list of service names in company data. Show add/edit/remove list controls only for services; enforce the same mode at the canonical API and public RAG projection. On mode change to products, invalidate the service-list context while preserving historical stored data. Do not create priced/scheduled catalog offers from this informational list.

- Nenhuma decisão de produto pendente para apresentar o plano de tarefas: horários avulsos e bloqueios foram confirmados. Comparecimento, início, conclusão e ausência reutilizam transições operacionais explícitas já existentes, separadas do financeiro.
- Datas reais, equipe, políticas e material da empresa piloto são insumos de ativação. Os testes locais usam identidades e fatos sintéticos marcados, sem pacientes reais.
- Conteúdo educativo em segmentos regulados exige fontes publicadas sob responsabilidade da empresa. A ausência de fonte não autoriza resposta clínica improvisada.

## Evidence and Next Step

- Active execution root after T2: `C:/tmp/zyon-service-business-20261114`, branch `feat/service-business-20261114`, from commit `6b71040e94bb4dccefb499763f97a20f26b275ea`. T1 b506dbd14 and T2 are committed. New worktree started clean. The prior R checkout remains intact with unrelated historical .specs modifications; do not import, stash or delete those changes. Worker service_batch_01 continues T3–T9 here; no duplicate worker is needed. Production remains untouched.

- 2026-11-14, user approved tasks and refinements: "Aprovar o plano e iniciar implementação local". Plano de 71 critérios, 95 tarefas e 13 fases, com subagentes e preservação de produtos no WhatsApp/storefront. Registrar a aprovação em tasks.md e iniciar pelo baseline isolado. Não pedir essa autorização novamente.

- Base da análise: isolated repository C:/tmp/zyon-whatsapp-final-prod-20261028, source 02204e523cabf377ad4b0f7578ebae7aac17e65a.
- Inventário, lacunas, fases e matriz de validação: docs/plans/whatsapp-services-business-rag-discovery-2026-11-14.md.
- Especificação de 47 requisitos escrita após resolver as decisões de produto; validate_spec.py passou com zero erros e zero avisos antes da apresentação.
- User approved specification: "Aprovar a especificação apresentada", 2026-11-14. Aprovação registrada em spec.md. Tarefas ainda não foram aprovadas.

## Planning Reviews

**Dispatched:** Planned read-only reviewers `service_agenda_plan`, `service_dashboard_plan`, `business_rag_plan` on HEAD 7229739c7b0da6bbe8da9a7746090e48ae81a7e7; requested by user; no implementation workers dispatched.

**Returned:** Os três revisores entregaram relatórios em `C:/Users/Admin/Desktop/AACP/.audit/service-plan-20261114/`. Incorporar recurso compartilhado por profissional, agenda independente de pedido pago, modo humano separado do ciclo de vida da sessão, bridge real de mensagens, descrição canônica de 1.200 caracteres e reconciliação da base frontend/API. A revisão de agenda recebeu complemento somente leitura sobre regressões de produtos após a orientação abaixo.

**Final planning review returned:** service_dashboard_plan revisou design/tarefas e apontou três lacunas incorporadas: endpoint de escrita para grade/exceções, exclusividade nos escritores de catálogo e registro/testes no AppModule real de componentes posteriores. A revisão confirmou os ajustes e não encontrou outro erro material. Não equivale à verificação independente da futura implementação.

### Existing production journeys are binding

**Observed local catalog defect (2026-11-16):** actual105 service screenshot showed the rule-loading error toast. Source PromotionSection160 requests advanced-rules whenever a saved productId exists, although its own render uses hasFeature("advancedRules") and backend requires Growth. The fixture deliberately uses Starter; changing that tier or suppressing the toast would conceal the issue. New CAT05/T107 will enforce the existing feature policy and retain enabled behavior. No new entitlement decision or release approval. Exact request/status and final clean capture are required before marking the repair complete.

**Observed confirmation:** C105 third browser diagnostic's allowlisted network observer confirmed advanced-rules GET403 in both product and service modes. The source cause is existing billing guard148 plus PromotionSection160. The Starter fixture stays unchanged for the negative proof; T107 is separate from105's toggle migration.

**Settled test correction (T54 ticket activity):** 2026-11-16 - user: "Sim, corrigir a expectativa do teste (recomendado)" (reply call_f467064279f64627b220b0e1727ef4da). Approved exactly the external candidate6c32932e9c25c627dbecc49b2bdb46f7db9ddb5092e84dcc6263ae7575884f86 / patch06290559f6f04eb24d3ae7e3185e9abc09fb79a53bcf79d1a6eedcf67b589fed over originala19442c8cd312c84193af6cc8b557cc4ec30714c10bb8c78ce8a6734e8a088b7. Only ticket.updatedAt in four comparisons/five child contexts becomes exactly queued message.createdAt, as existing persistSupportMessage requires. All other ticket/session/checkout/binding/result/duplicate/privacy assertions stay intact; no productive rule changes. Apply exact candidate and rerun the actual9-case entry, with the unchanged35new+13old+7runtime Full scope.

- User: "lembre-se que esse fluxo pensado em serviço nao pode prejudicar o que ja funciona hoje e ja está fechado e aprovado em produção isso vale para whatsapp quando para o storefront são apenas nichos de engocios diferentes com fluxos de negocios diferentes".
- Modalidade comercial seleciona a jornada de negócio no servidor e nos dois canais. A empresa de produtos conserva catálogo, carrinho, checkout, frete, pagamento, pedidos e estoque existentes.
- Componentes compartilhados não autorizam mudança das regras comerciais já aprovadas de produtos. A nova agenda não substitui o checkout de produtos nem relaxa suas exigências financeiras.
- Antes da ativação, comprovar regressão de produtos e aceitação de serviços na mesma revisão candidata, com tenant de cada modalidade. Separar evidência local, integração de provedor e uso real.
- A implementação terá expansão de esquema compatível, habilitação restrita por empresa e desativação segura da entrada em novos agendamentos, sem apagar dados ou abandonar agendamentos e pagamentos existentes.

**Settled test correction (T29 TTL):** 2026-11-16 - user: "Sim, corrigir o teste de expiração (recomendado)". Approved only candidate0473f8ca554c3c3916f1b466c622f1e8bb23a70e82eadfc99eee79183b28ab44 / patchbe497f7eeacb9319cf141800b246b4502ce9de48519a7f40ac976ae76690e0e3 over original8d86c21cb610914ee331219e0d15f01d0634f698db4470b69e2b0e94d7b513ad. The new TTL expectation now checks effective held.expiresAt between actual Redis TIME before/after plus configured4min; physical PTTL stays positive. Existing storage retention+24h and all26 inherited journal assertions/negative cases remain. Exact candidate applied; productive source/artifacta983/46ba unchanged. Real journal10 rerun and Full29 remain required before completion; Root69 currently owns heavy.

**Execution resumed (2026-11-16):** user: "entao prossiga ate fecharmos com isso". Root recorded the explicit resumption before dispatch. The earlier review-only restriction remains historical; local implementation of originalT30-T32 resumes, with no product/remote expansion. Root owns checked69: source/test preparation only, no units/build/native/containers until heavy handover. Separate kanban/telephone fallback/cadastro UI inventory grants no new state or rule here.

**P baseline alignment checkpoint (2026-11-16):** Root authorized source/git alignment after the separately retained24-component green receipt. Normal merge0b345b70b6bc6aebab7a7a185a67cc5a9fe80974 integrates only committedaa30b1511; its clean baseline tree equalsRoot before restoring ownT30. Original20WIP bytes and formal plans are preserved in .cache/t30-alignment-20261116; no Root dirty99/parked70 source, output or dependency was copied. Own confirmation/oracle bytes remain exact, shared-types preserves both currentRoot operator exports and own optional cart fingerprint, metadata retains Root approved scope/status. No unit rerun, checked/native execution, T30sourcecommit or Full completion follows from alignment; concrete native100TAP+48normal+176widget and header gaps remain pending.

**P committed Root99 alignment checkpoint (2026-11-16):** Root authorized the next local source/git alignment while M55 owns the sole runtime. Normal baseline-only merge9c91773c03deaad2a70375d8f683e1bef1f9b59b integrates only committede6a53bad21ca9ee6aa8de1e387b045576aa4c442; its tree4b6512bf equalsRoot99 before ownT30reapply. Fresh backup .cache/t30-align-root99-20261116 preserves current20WIP/tasks/baseblobs/patch and125older packet files; explicit21pathstash4fdf1c5b remains retained. Own implementation/test/fixturead6 bytes and optionalcart_fingerprint remain exact, with Root99DI/schema/actualmetadata intact. T31/T32/allT71 drafts stay cache-only, no sourcecopy or taskmark. No unit repetition, import/parser/build/native/DB/browser/resource probe or currentFull claim follows; matrix100TAP+48normal+176widget still awaits a specific execution handover and ownfreshcheckedAPI.


**Settled company timezone (2026-11-18):** user: "Sempre horário de Brasília, sem configuração" (call_0c799f25b28a46bd8357f77bdf1b5b11). Company scheduling/dashboard period boundaries use the fixed IANA zone America/Sao_Paulo, identified as horario de Brasilia, with no editable company timezone setting. Preserve each historical appointment timezone and absolute instants. A separate scope question is pending about removing professional/availability timezone inputs as well; that broader change is not assumed from this company-level answer. Current35/60 gates are independent.


**Settled fixed timezone scope (2026-11-18):** user: "Sim, Brasília em todos os novos cadastros e agendamentos (recomendado)" (call_762ec883a4b14ab2a1f12947ae4b77b4). All new service professionals, availability and appointments use America/Sao_Paulo, with no timezone chooser. Preserve historical timezone snapshots and absolute instants; do not rewrite prior appointments or silently shift historical availability. The previous company-only scope question is resolved. Product business flows remain unchanged. A bounded impact assessment will place this explicit refinement in the remaining atomic work before final verification.


**Fixed timezone delivery placement (2026-11-18):** Explicit answers are delivered by111 new-record server policy,112 canonical booking/trusted-history compatibility and113 UI/control evolution after83/47 and before84. No global timezone rewrite or public legacy flag. Existing new-write/control tests evolve for the new user rule; unrelated historical/security/payment/stock assertions stay protected.

**Resource-window reply (2026-11-19):** user: "Vou liberar memória agora" (call_a257c2f01736447c857e4e7ba8d6467e). This is an intent to free resources, not an observed memory reading or approval to terminate applications. Resume each required gate only on its unchanged fresh admission. Visual feedback remains separate.

**Pending receipt policy precision (2026-11-19):** Root asked whether a local attendance receipt may record partial amounts while keeping the remaining balance pending, or must settle the full outstanding balance. This is not answered/approved yet. BOOK-07/T37 command implementation must not choose a rule from schema cardinality. Existing T36/T62 work continues independently.

**Pending T36 test-oracle correction (2026-11-19):** New late-payment test expected the raw Redis checkout key to disappear after lease expiry. Actual existing Lua retains it for ttl+86400000ms; expiresAt controls validity. Proposed patch15238afd40318157b716c6c94f92f2edb6ecb2212b1d5af4544fa2b46e6e3caf checks expired timestamp by RedisTIME and exact retained payload preservation, retaining other negatives/state/money assertions. Approval requested under tlc-spec-driven implement.md; NOT received/applied. Separate synthetic competitor required-contact completion is fixture setup only, with all prior oracles preserved and stronger precondition.

**Settled receipt policy (2026-11-19):** user: "Registrar somente a quitação integral do saldo" (call_917429d4418143408cc57e769332d11b). Supersedes the pending precision above. T37 accepts only the complete outstanding amount; partial amounts and overpayment are rejected. The server computes remaining balance, and recording does not mark attendance or imply PSP confirmation.

**Approved T36 expiry test correction (2026-11-19):** user: "Corrigir somente essa expectativa (Recomendado)" (call_2649816d086d45c2bd6b92af3a3c2cdb). Exact patch15238afd applied once after verifying cd8947ff; only the reviewed expired-record assertions changed. All other cases, money/state/tenant negatives and production API preserved. Candidate c1d774341901e375d8d71a94ec67bae39636da995f345a69924b7af8af4e8962. Actual gate remains pending.

**Approved T62 foreign ticket oracle (2026-11-19):** user: "Corrigir somente essa linha (Recomendado)" (call_deccc27c26364dd295c4ea885e841b0e). Authorizes exactly patch76e39822e7c790061ef29934aae5d33afca976210b2aeeb81add88b8eb62a3ef, one new Browser test comparison403->404. M owns the one-time application/receipt; Root has not applied it. Private profile/context403 and all four cases/data-absence checks stay intact. No API change or new permission flow.

**Resource reply (2026-11-19):** user: "Vou liberar memória e aviso quando terminar" (call_a9e7c49235ce4b3e8d34a6bb54eebd10). This is intent plus a promised later confirmation, not a completed availability reading. Root/M remain source-only with no SUT/probe until an actual new window is established; no foreign app/process termination authorized.

**T62 approved test patch verified applied (2026-11-19):** Root inspected M approved-applied-receipt.json and the current Browser source. Original0e9b95d6 became6faac08b by the exact approved76e39822 one-line403->404 change; all four cases remain and execution is0. This supersedes application-pending status above; never request the same approval again.

**Resume request (2026-11-19):** user: "o que falta ainda para terminar? prossiga". Resume the authorized local work and make one fresh guarded attempt at the outstanding T62 UI87 gate. This does not assert that memory was freed and does not authorize closing foreign applications. All previous approvals remain effective.


**Approved T37 admin-login test correction:** 2026-11-19 - user: "Corrigir somente essa expectativa (recomendado)" (call_7c50b1827d2648748b894122500479e0). Exact8c95357e permits only HTTP200->201 in the new admin login precondition; existing AuthController/Post contract and all other assertions/API remain unchanged. Applied once, receipt .cache/t37-admin-login-precondition-review-20261119/approved-applied-receipt.json; never ask/apply again.


**Open KPI-04 precision, 2026-11-19:** Asked user which base Received uses when payment includes fees: effective service amount without buyer-added fee; gross buyer payment including fees; or merchant net after deducted fees. No answer/default assumed. Clarify before85; this does not block37 local receipt fact. Optional current Conversations desktop visual feedback is also pending, without technical release approval inferred.


**Settled mid-build 2026-11-19T16:28:40.946415+00:00:** user: "quero ajuste use /impeccable para ajudar num layout mais premium e exclusivo". The current Conversations desktop preview is not visually approved. Refine that existing WhatsApp Conversations surface/Staff host/drawer with the current workspace impeccable skill, preserving role/tenant/auth/draft/send/close/URL semantics and product journeys. No new data sources, invented buyer identity/global metrics or backend feature is authorized by this visual request. Show new real desktop/mobile captures; existing headers/UI/browser evidence remains historical wherever productive markup/style changes. User previously chose continuing the current skill version; do not ask about updating again.

**Settled KPI-04 received base 2026-11-19T16:28:40.946415+00:00:** user: "Valor dos serviços efetivamente pagos, sem taxas adicionais do comprador (recomendado)". Received counts the effective paid service value (including effective discounts) and excludes fees added to the buyer. Example: service100+buyerFee2 yields received100. Use deduplicated PSP/local evidence, preserve confirmed service money without a booking and flag incomplete unit/fee allocation rather than guess. This defines existing85/86 metrics, not an extra KPI.

**Desktop visual style approved 2026-11-19T17:55:35.310017+00:00:** user: "Aprovar o estilo do desktop" (call_28d46de81a384fc5991547007d8ae055). Approval concerns the two real desktop previews, queue205f1326 and drawer26935f85, with premium presentation tokens/styles preserved through the later selected-tab and quiet-read fixes. It is not approval of unfinished technical gates, mobile behavior, feature completion or publication. No question on desktop style remains pending.


**Approved T38 zero-price native test correction:** 2026-11-19 - user: "Corrigir somente esse teste (recomendado)" (call_4b91ada15f83480d99c5539622ba1540). Exact patch98dff479/originalb013ab80/candidateaaa42d02 applied once after approval: one new native case now checks the existing zero-price rejection with no business/transport changes and restores fixture price in finally.14 cases/all other13 declarations and assertions preserved; API unchanged. Never reask/reapply; receipt .cache/t38-zero-price-test-review-20261119/approved-applied.json.


**Approved T100 three new-test expectations:** 2026-11-19 - user: "Corrigir somente essas expectativas (recomendado)" (call_74bc4d7bea2948fd88d4d5e23b2795ea). Exact isolated patch2d64d81c permits only two TenantContext.get undefined->canonicalnull and removal of arbitrary5511fragment from native privacyregex, preserving both fullphones/othercanaries/allotherassertions. API unchanged. Approval recorded now; application waits current own-offline-bootstrap natural handback to preserve sourcefreeze. Do not reask or broaden; exact before/after receipt required on once-only application.


**T100 exact approved patch applied once 2026-11-20T00:20:20.339458+00:00:** Isolatedreceipt c5afe14c verified, usercall_74bc4d7bea2948fd88d4d5e23b2795ea and exact2d64d81c. All3hunkinverses exact against currentfixtures, allotherassertions/fixtureadditions preserved; execution0. Approval consumed, no questionpending/reapply. LaterF100-1/2/3 changes are independenttestsfirstsourcefixes, not additionaloraclereplacements.


**Approved T39 local synthetic presentation**: 2026-11-19 - user: "Aprovar a apresentação" (call_62b86875b2524682acd239d3f85af177). Approval covers the shown appointment confirmation/payment-at-attendance/five-tone local synthetic previews, not actual WhatsApp/provider or final44/45 screens, technical gates, task closure or production. Six exact artifacts in .cache/t39-source-20261119/visual-preview/generated/captures; generation0bb86a59/capturefa891b71.


**User memory response**: 2026-11-19 - user: "Vou liberar memória e avisar" (call_18cb98f7cdee414189664b3151f8ac9d). This is an intention, not confirmation of completion or proof of fresh admission. Continue small/independent work; original guards remain mandatory.


**Approved widget parent watchdog exception**: 2026-11-19 - user: "Aprovar apenas o limite de 5 minutos" (call_69d9fe48fb014b1ba2cd9f4fd8a72599). Exact patch3609375592cfaed06964739babd8efcc478e3780acf7dd193c71fc90f83a8e6c authorizes ONLY test-driver parent watchdog180000->300000 on the TWO local checkouts Root/M; worker176cases/allfunctionalassertions/internalwaits/heap256/PG128/memory/network/cleanup unchanged. This explicitly revises the original gate budget, not a neutral retention or productSLA change. Original145/158partialfailures remainfailed, no whole176pass implied. Rootmayapply now; Mmustwait currentnative16/inbox9 naturalhandback before any sourcechange. No reask/reapply.

**Approved T100 new private test case correction**: 2026-11-19 - user: "Corrigir somente o novo caso privado" (call_8b8b2307a0284388b16a518d8102e51e). Exact patch63401404 authorizes ONLY newly expanded support_case_alert loop case/title in send-whatsapp-message.spec.ts (3a7b759d->0ed16cb6): none/skipped/private_staff_alert_required and zeroexistingWhatsApp/email/Bubble counters; all46cases andother45bodies/assertions/titleoutputs unchanged. API/27sources unchanged. Apply ONLY after currentMnative16/inbox9 naturalhandback to preserve its d719 input fence. No reask/broaden/reapply; before/after receipt mandatory.


**T79 visual approved, 2026-11-22**: user: "Aprovar o visual" (call_e1b9eff39a82467097ee79da7f7b086d). Approval covers the displayed manual-booking form and service/professional/duration/registered-price summary at1440x1000 and390x844. Preview receipt917a0ec3, synthetic GET-only, no technical/API/SQL/provider acceptance inferred. Original runtime and production gates remain mandatory.


**T45 customer visual approved, 2026-11-22**: user: "Aprovar o visual" (call_0efb468cbf1d439d8c331da62d1ddf56). Covers the displayed customer desktop review and mobile confirmed/pending-at-attendance screens. Actual component/client/styles, explicitly synthetic transport/data. Preview2cases8frames receipt1a7202f4, original budget/cleanup and23pins exact. This does not approve technical behavior, served storefront, SQL/auth/provider or production. T79 manual form was separately approved by call_e1b9.


**Approved**: 2026-11-22 - user: "Corrigir somente essas verificações (recomendado)" (call_9aadb87e3c6f42709a3020791e861108). Bounded T94 patch8665a545 applied ONCE: five negative-test matchers now inspect actual HTTP409/getResponse code service_activation_not_ready and exact release_manifest_missing blocker; all seven contexts and other assertions retained. API unchanged by this oracle correction. Exact before/after receipt: .cache/t94-error-contract-test-review-20261122/applied.json. No wider approval or task closure inferred.


**Approved**: 2026-11-22 - user: "Aprovar somente os dois ajustes de testes (recomendado)" (call_6a68b53b704d42abadc15d39b086cea4). Patches da87caef and5b4efa52 applied ONCE only: the duplicate-proof fixture now repeats the identical command, retaining its rejection assertion; the new native activation negative asserts409/exact code/release_manifest_missing blocker. Other cases/assertions and API preserved. Native source is newly adopted with its approved correction, not executed and not accepted until its real writer/ABI dependencies/currentbuild gates. Exact before/after receipt .cache/t94-two-tests-approved-20261122/applied.json. Prior five-match approval9aadb was already consumed separately; no broad test-change authority inferred.


**In-scope QA03 validation finding, 2026-11-22:** local component test with real MP signature/adapter/handler/dispatch and captured HTTP/in-memory persistence reproduced acceptance of mismatched/missing observed financial facts (3pass10fail;6a5de317). Three local source corrections now require actual observed amount/currency/reference/payment ID before event reservation; new13pass. Existing old10 has two mocks missing the newly required facts; bounded patch ecc80e84 is pending user approval, not applied. No AppModule/SQL/external provider or production incident proof is claimed. This follows existing financial-truth/tenant/rollback criteria, not a new product policy. Official GetPayment response examples also include decimal strings, so the local adapter needs bounded exact parsing before it can be considered compatible. Official Asaas deletion docs do not establish safe atomic card cancellation: the current implementation's card→Pix refusal is a code limitation, not a blanket claim about the provider. https://docs.asaas.com/reference/excluir-cobranca distinguishes removal from refunds. No external charge, cancellation or refund was attempted.


**Approved**: 2026-11-22 - user: "Aprovar somente os dois retornos do teste (recomendado)" (call_1e3b3ba81b604830854f052e9f4159a4). Patchecc80e84 applied ONCE only: the two successful old MP provider stubs now supply matching observed10000cents/BRL/intent reference. All10 cases, names, assertions, remaining fixtures and API preserved by this patch. The separate local financial correction already passed13 new source cases after original3pass10fail; no native/external/production acceptance inferred. Exact before/after .cache/reg02-mp-old-fixtures-approved-20261122/applied.json. No wider test authority inferred.

**Approved**: 2026-11-22 - user: "Aprovar apenas esse perfil para a API" (call_a66b8339561247228f507676aae76c09/0). Authorizes only the concrete local API profile v2 7581ff8b:3072MiB per-Node old-generation limit,3840MiB fresh available-commit admission and workspaceConcurrency1, modes api-types/checked. All configured TypeScript/source scope, tests/assertions, package scripts, network guard and normal own artifact capture/build/record/admission stay required. Original76df/v1e337 preserved; native/browser2048, PG128, frontend boundaries and timeouts unchanged. Per-process limit is not aggregate/native/RSS isolation. Any OOM/guard/compile failure stays failed. No deploy/push/remote DB/provider/customer action authorized. Exact approval record .cache/controlled-api-profile-proposal-20261122/approval.json.


## Pending T40 recovery test correction

User approval requested after actual native6911ad1c. Existing recovery testcase requires a checkout persisted after initiallease acquisition503; new approved concurrency invariant prevents publication until the lease exists, so actualcheckout isnull. Proposed patch8fdee74d updates only two failure-stage expectations (checkoutnull,startedEvents0), then recovers using the same authorized prepare and removes the exact owned capturedlease before the original readonly/review assertions. Same25contexts, no backend/timeouts change. Patch .cache/t40-initial-lease-recovery-test-review-20261122/proposed.patch is prepared but NOTAPPLIED. TLC references/implement.md requires userapproval before wrong-oracle modification; question includes exactlink/quote. No answer recorded yet; do not treat silence as approval.


**Approved T40 recovery test correction, 2026-11-22:** user: "Aprovar somente esse ajuste do teste (recomendado)" (call_93541acdc6574770935719fa0b1f76a6). Exact proposed patch8fdee74d(normalizedLF; diskCRLFde1e2418) applied ONCE to native40879f56 over6d5a9982. Initialfailedlease now asserts checkoutnull/startedEvents0; samecapability realprepare recovers and exactcapturedlease is removed before ALL original readonly409/review/continuation assertions. Same25cases, noAPI/backend/guard/timeout change. .cache/t40-initial-lease-recovery-test-review-20261122/approved-applied.json is authoritative. Pending question RESOLVED; never reask/reapply/broaden.


**Approved**: 2026-11-22 - user: "Corrigir somente essa expectativa (recomendado)" (call_4ec7236307ef4655b24cd03ae896af16/0). Exact .cache/t40-manual-br-test-expectation-review-20261122/proposed.patch881e70fb applied ONCE to Root and focused manual test220b0d85->4df4d012: only new appointment expectationUTC->America/Sao_Paulo, all16cases/allotherassertions preserved, no API behavior change. approved-applied.json is authoritative. Pending test question RESOLVED; do not reask/reapply/broaden.

**Approved**: 2026-11-22 - user: "Aprovar o visual" (call_c1aa9b077799400381e2bac348903236/0). T101 national DDD+phone withoutDDI visual-only approval of the two shown local1440x1000/390x844 archived frames03a5e34c and6ac2086c from .cache/t101-browser-gates/2026-11-22T00-42-04.969Z/new7-captures. This is NOT fresh current API/browser/provider acceptance; existing functional gates remain required. Visual question RESOLVED, no production action authorized.

**Approved**: 2026-11-23 - user: "Corrigir somente teste e fixture (Recomendado)" (call_79852ff77f9c4b1ab0f356ab33e70c4c/0). ONLY T28 .cache/t28-br-new-selection-test-review-20261122/proposed.patch d248d9da applied ONCE to Root+Focus01d4e639->b2b71803; oneUTC->Brasiliaoutputexpectation +8localnewBRfixturehunks. All9cases/148assertions/otheroracles/guards/budgets/prices andsharedUTCseed unchanged, noAPIbehaviorchange. approved-applied.json authoritative; wholeactualrerunpending. QuestionRESOLVED, neverreask/reapply/broaden.

## Local Docker recovery authorization, 2026-11-23

User: "Autorizar rein?cio do Docker Desktop" (call_52f6b600a4844e5f8653d74fcb6347f0). Authorizes the local Docker Desktop restart required to recover the unresponsive test engine. No volume/image/data deletion, production action or broader permission. Exact approval is retained at Root .cache/docker-desktop-recovery-20261123/approval.json.

**Approved**: 2026-11-23 - user: "Corrigir somente essa linha (recomendado)" (call_25d75bd0d8fd4926878246a660547fc3/0). Apply only the T103 new service-filter spec expected catalog path `/merchants/merchant-a/products` -> `/v1/merchants/merchant-a/products`, proposed patch .cache/t103-service-filter-test-prefix-review-20261123/proposed.patch. Two cases/all other assertions/API unchanged. Applied once; whole two-case rerun pending. Other consolidated test proposals remain pending.

**Approved**: 2026-11-23 - user: "Aprovar somente os três patches de testes (recomendado)" (call_7e90587fa14a4636b8853394a2d80f1a/0). Exact five test/fixture candidates from .cache/consolidated-test-integrity-review-20261123/manifest.json eecf13a8 approved: native manual single new-BR expectation b849; T78 browser/fixture b339/68f4; two S5 payment-duplex browser expectations2053/19ac. Preserve all other assertions/cases/guards and API; apply each once with before hashes. This resolves and supersedes the pending consolidated review, no broader test or production authority.

**Approved**: 2026-11-23 - user: "Aprovar somente essas oito linhas (recomendado)" (call_70c194b2a34140abb59de883db83ac3c/0). ONLY the exact eight expectation lines in .cache/t29-t30-owned-http-continuation-preconditions-20261123/all-eight-expectations-pending.patch, bound by eight-expectation-lines-approval.json: T24/T25 new civil-time/grade expectations in Brasilia and T30 new appointment zone plus verified buyer email snapshot. All cases, other assertions, absolute ISO instants and explicit historical UTC/Manaus remain. API unchanged. Approval received; each hunk must be applied once against its bound source during ordered composition, never broadened or reapplied.

**Approved eight applied once / next native cohorts, 2026-11-23:** Exact approved8 plus declared valid BR/public continuation preconditions adopted Root ff81f06d and Focus b3de0d6b, five files, source137 still exact; source packet22799da9. T24 whole8 actual6pass/2fail including parent99a9beda, sole failing staff civil-time vector is OUTSIDE earlier8approval. One-line review7decf70e USERPENDING; API/historical rows/assertions unchanged. Root runs remaining wholefiles T25/T29/T30 separately and sequentially under original2048/600000/ownedcleanup, stops first failure. No false Full33 claim.

**Approved**: 2026-11-23 - user: "Corrigir somente essa expectativa (recomendado)" (call_9afd5aef66df4658a4e469095c7e4d14/0). ONLY .cache/t111-t24-staff-br-read-expectation-review-20261123/proposed.patch7decf70e: staff read civil-time vector10:00/10:30 ->07:00/07:30. Eight cases, historical UTC records, authorization/no-mutation assertions and API unchanged. Applied ONCE Rootb240227c->4d48edca; Focus deferred until current independent native25 returns. approval.json/root-approved-applied.json bind exact action. Never reask/broaden/reapply.


**Approved**: 2026-11-23 - user: "Aprovar somente os três patches (Recomendado)" (call_cde468a7a930458a835d78c5336d8490). ONLY exact three test patches2070c610/version,107e5a69/Decimal and930e79fb/migration snapshot projection with BOTH new fields strictnull. Earlier replies710b(version) andd57(version+Decimal) cover the same hunks and are superseded; apply each ONCE, never twice. Current Native18c33 includes reviewed privateV2 and must be preserved when composing the sole Decimal expression. No API rule/other oracle/case/timeout change. Approval received while ownnative27 exec14102 runs; application deliberately waits natural handback to keep source freeze183/native supplement exact. Approval .cache/consolidated-three-test-approvals-20261123/approval.json. Never reask/broaden/reapply.


**Approved three patches applied ONCE, 2026-11-23:** Exact usergrant cde468a consumed only after native27 natural handback99c2499a. Root+Focus four test files updated, eight writes; Native18 current privateV2 opt-in retained while composing sole Decimal expression. Version92547221, migrationfixture33155c6e/spec31b50cf2 and current combined Native18 hash are bound by .cache/consolidated-three-test-approvals-20261123/applied.json. API rules/cases/other oracles/timeouts unchanged. Earlier710b/d57 were duplicate scope, NOT applied again; no question pending, do not reask/reapply. Whole affected9/18/9 still required.


## Metrics test corrections and overview visual approval 2026-11-23

**Approved**: 2026-11-23 - user: "Aprovar somente os dois ajustes de testes (Recomendado)". Consolidated question call_4462b47008f346c28b2c82c2aba7d82f supersedes the duplicate single bridge approval call_6c3dad2337a84b598eb05ffc01228826. Apply each hunk once: canonical bridgeStatus cleanup contract, and foreign-tenant query403/tenant_mismatch_query while ordinary invalid queries remain400. All21 contexts, other assertions, data, timeouts and application behavior remain unchanged. Patch `.cache/service-metrics-two-expectations-review-20261123/combined-proposed.patch`.

**Approved**: 2026-11-23 - user: "Aprovar o visual do desktop" (call_7baec54601664dfd9586f1956ebd71cf).

**Approved**: 2026-11-23 - user: "Aprovar o visual do celular" (call_8caffeedf852429185b3cbc8f281d79e). Actual local service overview screenshots; current whole-project browser proof aba2454a,4desktop+4mobile,20 captures. Visual approvals do not complete pending task dependencies, builds or final feature verification. No production authorization is inferred.


## Approved staff, worker budget and native blocker corrections (2026-11-23)

**Approved**: 2026-11-23 - user: "Corrigir somente essa expectativa (Recomendado)" (call_b4da43004b434f228000b56b6f628832). Staff expectation only; superseded by overlapping consolidated grant, apply once.

**Approved**: 2026-11-23 - user: "Aprovar somente esses ajustes (Recomendado)" (call_15cd1f4546014e29bac209a926f34401). Staff UTF8 expectation plus two journey worker budget lines, body60000/global600000/parent600000 unchanged.

**Approved**: 2026-11-23 - user: "Corrigir somente essa checagem (Recomendado)" (call_1ef23ffc45e24e1793e454a274cbce1b). Native readiness public HTTP plus exact canonical owned-SQL blocker expectation only.

Exact targets and before/after pins: .cache/staff-worker-blocker-grants-20261123/approval.json. The first Staff grant overlaps the consolidated grant and is consumed once. Only UTF8 candidate b4bf is valid; never apply old mojibake9ea. Native oracle35f8 preserves newly added manual contact; never copy old216 wholesale. Apply after the active API07 source freeze returns. No production authority or gate completion is inferred.
