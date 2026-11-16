# WhatsApp Service Booking and Business RAG Context

**Gathered:** 2026-11-14
**Status:** Specification approved; design and tasks in preparation. Tasks are not approved.

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

- User: "lembre-se que esse fluxo pensado em serviço nao pode prejudicar o que ja funciona hoje e ja está fechado e aprovado em produção isso vale para whatsapp quando para o storefront são apenas nichos de engocios diferentes com fluxos de negocios diferentes".
- Modalidade comercial seleciona a jornada de negócio no servidor e nos dois canais. A empresa de produtos conserva catálogo, carrinho, checkout, frete, pagamento, pedidos e estoque existentes.
- Componentes compartilhados não autorizam mudança das regras comerciais já aprovadas de produtos. A nova agenda não substitui o checkout de produtos nem relaxa suas exigências financeiras.
- Antes da ativação, comprovar regressão de produtos e aceitação de serviços na mesma revisão candidata, com tenant de cada modalidade. Separar evidência local, integração de provedor e uso real.
- A implementação terá expansão de esquema compatível, habilitação restrita por empresa e desativação segura da entrada em novos agendamentos, sem apagar dados ou abandonar agendamentos e pagamentos existentes.

**Settled test correction (T29 TTL):** 2026-11-16 - user: "Sim, corrigir o teste de expiração (recomendado)". Approved only candidate0473f8ca554c3c3916f1b466c622f1e8bb23a70e82eadfc99eee79183b28ab44 / patchbe497f7eeacb9319cf141800b246b4502ce9de48519a7f40ac976ae76690e0e3 over original8d86c21cb610914ee331219e0d15f01d0634f698db4470b69e2b0e94d7b513ad. The new TTL expectation now checks effective held.expiresAt between actual Redis TIME before/after plus configured4min; physical PTTL stays positive. Existing storage retention+24h and all26 inherited journal assertions/negative cases remain. Exact candidate applied; productive source/artifacta983/46ba unchanged. Real journal10 rerun and Full29 remain required before completion; Root69 currently owns heavy.
