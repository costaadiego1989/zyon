# Prompt Adaptado — Documentação Técnica do AACP

> **Nota:** Este prompt adapta o template original "AIOS" ao contexto real do projeto **AACP (Agentic AI Checkout Platform)**. A estrutura, regras de qualidade, templates e lotes foram preservados. Slugs, módulos e personas foram mapeados ao código e docs existentes.

---

## Contexto do Projeto

- **Nome:** AACP — Agentic AI Checkout Platform
- **Tipo:** Plataforma de checkout agêntico multi-tenant
- **Merchant boundary:** `merchant_id`
- **Buyer boundary:** `global_user_id`
- **Stack real:**
  - Backend: NestJS + Prisma + PostgreSQL + Clean Architecture / DDD modular
  - Frontend Dashboard: React + Vite + Tailwind + shadcn-style
  - Frontend Widget: Embed conversacional (web)
  - Packages: `rules-engine`, `decision-engine`, `conversation-engine`, `shipping-engine`, `negotiation-engine`, `commerce-adapters`, `agentic-checkout-js`, `shared-types`, `contracts`, `recomendation-engine`, `payments-evm`
  - AI: OpenAI / Fable 5 (com fallback determinístico)
  - Pagamentos: Asaas (PIX/boleto), Stripe, Crypto (EVM)
  - Auth: JWT + WebAuthn + OTP
  - Lojas: Shopify (Admin + Storefront GraphQL)
- **Engine de decisão central:** `decision-engine` (pacote puro, sem NestJS)
- **Status atual:** **MVP pronto, pós-P0 hardening** — checkout funcional, billing Asaas integrado, Shopify sync, suporte parcial a múltiplas integrações.

---

# Documentação Técnica do AACP — Etapa 2

## Objetivo

Com base exclusivamente no código real, ADRs em `docs/architecture/adr/`, RFCs/`.specs/`, e nos planos em `.specs/features/`, crie documentação técnica detalhada para cada módulo do AACP, cobrindo:

- Domínio e arquitetura.
- Backend e API.
- Frontend e experiência do usuário.
- Banco de dados.
- Eventos e integrações.
- Segurança e permissões.
- Observabilidade.
- Testes.
- Lacunas e plano de implementação.

**Não implemente funcionalidades nesta tarefa.** Altere somente arquivos de documentação.

---

## 1. Regra fundamental

Não considere um recurso implementado apenas porque ele:

- Está mencionado em um RFC/spec.
- Está marcado com `[x]` em `tasks.md`.
- Possui somente uma interface.
- Possui arquivo vazio.
- Possui mock.
- Possui testes que não executam o fluxo real.
- Aparece em uma tela sem integração funcional.
- Retorna dados estáticos.

Para cada informação, classifique como:

| Status | Significado |
| ------ | ----------- |
| `IMPLEMENTED` | Implementado e integrado ponta a ponta. |
| `PARTIAL` | Parcialmente implementado, com lacunas conhecidas. |
| `SCAFFOLD` | Apenas estrutura, interface ou entidade vazia. |
| `MOCKED` | Simulado, stub ou dados estáticos. |
| `DOCUMENTED` | Existe apenas em spec, ADR ou RFC. |
| `PLANNED` | Planejado para fase futura. |
| `MISSING` | Ausente do código e da documentação. |
| `UNVERIFIED` | Não foi possível verificar. |

**Sempre apresentar evidências:** caminhos de arquivo, classes, funções, rotas, migrations, componentes, testes.

---

## 2. Estrutura da documentação

```
docs/
└── modules/
    ├── README.md                          # índice mestre
    ├── IMPLEMENTATION_MATRIX.md           # matriz de status por módulo
    ├── DEPENDENCY_MAP.md                  # mapa de dependências (Mermaid)
    ├── USER_JOURNEYS.md                   # jornadas de merchant/buyer/admin
    ├── auth/
    │   ├── OVERVIEW.md
    │   ├── API.md
    │   ├── FRONTEND.md
    │   └── IMPLEMENTATION.md
    ├── checkout/
    │   └── ...
    └── ...                                # 26 módulos do AACP
```

### Adaptações da estrutura

- **Preservar** os ADRs existentes em `docs/architecture/adr/` — referenciá-los, não duplicar.
- **Preservar** os spec files em `.specs/features/` — referenciá-los como plano de origem.
- **Preservar** `docs/architecture/bounded-contexts.md` — alinhar slugs a este mapa.
- **Não criar** estrutura paralela que conflite com a documentação oficial.

---

## 3. Índice mestre — `docs/modules/README.md`

Conteúdo obrigatório:

- Visão geral do AACP.
- Posicionamento do produto (checkout agêntico conversacional, M2M negotiation, multi-merchant).
- Arquitetura de alto nível (monolito modular NestJS + pacotes puros).
- **Lista completa dos módulos reais** encontrados na auditoria.
- Status real de cada módulo.
- Links para os 4 documentos por módulo.
- Dependências principais entre módulos.
- Ordem recomendada de implementação.
- Legenda de status (tabela).
- Separação entre **AACP Core** (atual) e **AACP Compute Network** (PLANNED).

### Tabela de módulos

| Módulo | Responsabilidade | Backend | API | Frontend | Testes | Produção | Prioridade |
| ------ | ---------------- | ------: | --: | -------: | -----: | -------: | ---------: |
| auth | Autenticação merchant (JWT, cookie) | `IMPLEMENTED` | `IMPLEMENTED` | `IMPLEMENTED` | `IMPLEMENTED` | `PARTIAL` | P0 |
| ... | ... | ... | ... | ... | ... | ... | ... |

---

## 4. Módulos atuais do AACP (auditados)

Lista real mapeada a partir de `apps/api/src/modules/*/`:

### Core — Negócio

1. **auth** — JWT login, cookie, registro de merchant, guards.
2. **onboarding** — wizard inicial, MerchantOnboardingState.
3. **merchant** — regras, configuração, MerchantRule.
4. **checkout** — sessão, eventos, scoring, chat, ofertas.
5. **checkout-settings** — comportamento do widget, triggers, supressão.
6. **agent-rules** — identidade do agente, capabilities, guardrails.
7. **buyer-purchase-history** — personalização do buyer por merchant.
8. **buyer-account** — conta buyer, OTP, WebAuthn, address, preferences.
9. **self-checkout** — checkout self-service, wallet, saved payment, template.
10. **scraping-agent** — PriceQuoteJob, scraping de preços de concorrentes.
11. **catalog** — catálogo de produtos do merchant.
12. **fulfillment** — shipment, tracking events, abandono.
13. **shipping** — cotações de frete (motor isolado).
14. **negotiation** — sessões M2M, cost ledger, policy, preferências.
15. **coupons** — cupons, redemptions.
16. **cross-sell** — promoções, sugestões.
17. **support** — tickets, settings, FAQ, quick replies.
18. **audit** — eventos de auditoria por merchant.
19. **integrations** — conexões com providers externos.
20. **installations** — MerchantInstallation (WordPress plugin).
21. **operations** — admin operations internas.

### Core — Pagamentos e Comércio

22. **payment** — Asaas intents, Stripe, Crypto (EVM), webhooks.
23. **commerce** — Shopify order sync, conexão por merchant.

### Pacotes (puros, fora de NestJS)

24. **rules-engine** — avaliação de descontos, margem, limites.
25. **decision-engine** — decisões de oferta (motor isolado).
26. **conversation-engine** — classificador de objeções, geração de copy.
27. **shipping-engine** — cálculo de frete (puro).
28. **negotiation-engine** — lógica M2M pura.
29. **commerce-adapters** — adapters para Shopify (GraphQL).
30. **agentic-checkout-js** — SDK cliente.
31. **shared-types** — tipos compartilhados.
32. **contracts** — contratos/eventos compartilhados.
33. **recomendation-engine** — motor de recomendação.
34. **payments-evm** — pacote de payments on-chain.

### Outros do template original que **não existem** no AACP

Estes devem ser classificados como `MISSING` ou `PLANNED` no índice mestre:

- Universal AI Gateway (`MISSING` — substituído pelo `checkout` orchestrator)
- Provider Adapters (`MISSING` como gateway — existe `commerce-adapters` para Shopify)
- Smart Router (`MISSING`)
- Complexity Classifier (`MISSING`)
- Semantic Cache (`MISSING`)
- Prompt Intelligence (`PARTIAL` — `conversation-engine` classifica objeções)
- Prompt Compaction (`MISSING`)
- Quality Harness (`PARTIAL` — `checkout-ai-safety-battery` é um feature de validação, não runtime)
- Adaptive Intelligence Loop (`MISSING`)
- Circuit Breaker (`MISSING`)
- BYOK (`MISSING`)
- OpenRouter Credit Broker (`MISSING`)
- Provisioner (`MISSING`)
- Cluster Manager (`MISSING`)
- FinOps (`MISSING`)
- Billing (`IMPLEMENTED` para Asaas via `payment`/`integrations`; faltam dashboards avançados)
- Metering (`PARTIAL` via `OutboxMessage`/`MerchantBillingSubscription`)
- Credit Wallet (`MISSING`)
- Governance (`PARTIAL` via `agent-rules`)
- AIOps (`MISSING`)
- Evaluation (`PARTIAL` via `.specs/features/checkout-ai-safety-battery`)
- Benchmark (`MISSING`)
- Portfolio Manager (`MISSING`)
- Recommendations (`IMPLEMENTED` via `recomendation-engine`)
- Agent Orchestrator (`IMPLEMENTED` via `checkout` orchestrator + `agent-rules`)
- Notifications (`MISSING` — falta canal dedicado, `support` cobre parcialmente)
- Observability (`PARTIAL` — logs estruturados existem; métricas/traces ausentes)
- Rate Limit (`IMPLEMENTED` parcial em `auth` via `LoginAttemptCounter`)
- API Keys (`IMPLEMENTED` via `MerchantApiKey`)
- MCP Server (`MISSING`)
- SDK TypeScript (`IMPLEMENTED` via `agentic-checkout-js`)
- SDK Python (`MISSING`)
- Dashboard Web (`IMPLEMENTED` via `apps/dashboard`)
- IDE Integration (`MISSING`)
- Team Memory (`MISSING`)

> **Regra:** se o código trata duas capacidades como um único bounded context, **não duplique**. Documente onde realmente vive.

---

## 5. Módulos do AACP Compute Network (PLANNED)

A Compute Network é uma feature futura. Documente todos como `PLANNED` exceto onde houver código real:

1. **Compute Provider Management** — onboarding de providers.
2. **AACP Worker** — agente instalado no nó.
3. **Node Registry** — cadastro de nós ativos.
4. **GPU Inventory** — inventário de GPU por nó.
5. **Model Artifact Registry** — versões de modelos suportadas.
6. **Model Deployment** — pipeline de deploy de modelo em nó.
7. **Capability Advertisement** — capabilities expostas pelo nó.
8. **Capacity Offers** — ofertas de capacidade (tokens/s, latência).
9. **Compute Scheduler** — escalonador de jobs para nós.
10. **Job Dispatch** — distribuição de jobs.
11. **Job Leasing** — leasing com timeout e preempção.
12. **Inference Execution** — execução de inferência.
14. **Streaming Gateway** — gateway SSE/WS para tokens.
15. **Execution Proof** — prova de execução (assinatura + logs).
16. **Usage Validation** — validação de uso reportado.
17. **Node Reputation** — reputação do nó.
18. **Fraud Detection** — detecção de fraude.
19. **Provider Balance** — saldo do provider.
20. **Settlements** — liquidação entre AACP e provider.
21. **Payouts** — pagamentos para providers.
22. **Disputes** — disputas de execução.
23. **Provider Portal** — portal web do provider.
24. **Compute Admin Console** — console admin.
25. **Security Tiers** — níveis de segurança por nó.
27. **Trusted Enterprise Nodes** — nós enterprise certificados.

> **Antes de criar um módulo novo da Compute Network, verifique** se a responsabilidade pode ser incorporada a um módulo atual do AACP Core (ex: `payment` cobre Asaas + Crypto, não criar `payment-fiat` + `payment-crypto` separados).

---

## 6. Template obrigatório de `OVERVIEW.md`

Cada módulo deve conter:

### Identificação

- Nome.
- Slug (kebab-case, alinhado com `bounded-contexts.md`).
- Bounded context.
- Tipo: Core, Supporting, Generic ou Compute Network.
- Status.
- Responsável lógico.
- Prioridade.
- Fase do roadmap (referência ao ADR).

### Propósito

- Problema resolvido.
- Valor para o merchant (cliente).
- Valor para o AACP.
- O que está dentro do escopo.
- O que está fora do escopo.

### Estado atual

- O que está implementado (com arquivo:linha).
- O que está integrado.
- O que está testado.
- O que está implantado em produção.
- O que é mock.
- O que existe apenas na documentação.
- **Evidências no código** (cite arquivos reais).

### Casos de uso

Para cada caso:

- Ator (Merchant, Buyer, Platform Admin, Provider Externo).
- Pré-condição.
- Gatilho.
- Fluxo principal.
- Fluxos alternativos.
- Resultado.
- Falhas possíveis.
- Eventos produzidos.

### Modelo de domínio

- Aggregates.
- Entities.
- Value Objects.
- Domain Services.
- Repositories.
- Domain Events (referência ao `domain-event.ts` se existir).
- Invariantes.
- Regras de negócio.

### Dependências

- Módulos consumidores.
- Módulos fornecedores.
- Banco (tabelas Prisma).
- Cache.
- Filas (OutboxMessage / Prisma Outbox).
- Serviços externos.
- SDKs / pacotes.
- Infraestrutura.

### Fluxo técnico

Diagrama Mermaid (real ou proposto) mostrando fluxo de dados.

### Segurança

- Dados sensíveis (CPF, cartão, OTP, etc.).
- Permissões (guards, `@Roles`, scopes de API key).
- Isolamento multi-tenant (`merchant_id`).
- Auditoria (`MerchantAuditEvent`).
- Ameaças.
- Mitigações.

### Observabilidade

- Logs (estrutura, request-id).
- Métricas (prom-client? OpenTelemetry?).
- Traces.
- Alertas.
- Dashboard operacional.

### Riscos e decisões pendentes

- Riscos técnicos.
- Riscos comerciais.
- Dívidas técnicas.
- Decisões que exigem ADR novo.

---

## 7. Template obrigatório de `API.md`

### Visão geral

- Responsabilidade da API.
- Consumidores (widget, dashboard, integrations, public).
- Base path (`/v1/`, `/api/`, etc.).
- Versão.
- Compatibilidade externa (Shopify? OpenAI? não se aplica aqui).

### Autenticação e autorização

- Tipo (JWT cookie, API key, public token, embed token).
- Scopes (`MerchantApiKey.scopes`).
- Roles (`MerchantUser.role`).
- Tenant (`merchant_id`).
- API keys (tabela `MerchantApiKey`).
- Permissões por endpoint.

### Endpoints existentes

| Método | Endpoint | Status | Autenticação | Responsabilidade | Arquivo controller |
| ------ | -------- | ------ | ------------ | ---------------- | ------------------ |

Para cada endpoint:

- Método e path.
- Objetivo.
- Headers.
- Path/query/body params.
- Request body (DTO).
- Response.
- Status HTTP.
- Erros.
- Idempotência (`HttpIdempotencyRecord`).
- Rate limit.
- Timeout.
- Exemplo de request/response.
- **Arquivo controller** real.
- Use case chamado.
- Repository utilizado.
- Eventos gerados.
- Testes existentes (spec).

> **Não invente contratos.** Extraia do `*controller.ts` e do DTO correspondente.

### Endpoints planejados

Separe claramente. Para cada:

- Justificativa.
- Contrato preliminar.
- Dependências.
- Critério de aceite.
- Riscos de compatibilidade.

### Schemas

- Zod, class-validator, DTO ou equivalente.
- Campos obrigatórios/opcionais.
- Enums.
- Valores padrão.
- Limites.
- Validações.
- Exemplos.

### Erros

Catálogo:

| Código | HTTP | Condição | Retryable | Mensagem segura |
| ------ | ---: | -------- | --------: | --------------- |

### Eventos

- Nome.
- Producer.
- Consumers.
- Payload.
- Versionamento (`eventVersion`).
- Idempotência.
- Garantia de entrega (Outbox + retry).

### Integrações externas

- Provider (Asaas, Shopify, Stripe, OpenAI/Fable 5, etc.).
- Autenticação (token location, header).
- Timeout.
- Retry.
- Circuit breaker (se existir).
- Custos.
- Limites.
- Fallback (determinístico quando credenciais ausentes).

### Segurança da API

- Input validation.
- Mass assignment.
- Injection (SQL — Prisma mitiga; NoSQL — N/A; command — N/A).
- Rate limiting.
- Tenant isolation (todas queries passam por `merchant_id`).
- Proteção de secrets (`.env`, nunca commit).
- PII.
- Audit log.

### Testes da API

- Unitários.
- Integração (e2e specs em `__tests__/`).
- Contrato (se houver).
- E2E (Playwright em `apps/widget/e2e`).
- Casos ausentes.

---

## 8. Template obrigatório de `FRONTEND.md`

**Mesmo módulos sem UI devem ter `FRONTEND.md`**. Quando não houver frontend necessário, declare:

- "Este módulo não necessita de interface direta no MVP."
- Como será operado (API, CLI, job).
- Quais outros módulos exibem seus dados.
- Se será necessário painel administrativo futuramente.

Para módulos com UI:

### Objetivo da experiência

- Usuário (Merchant, Buyer, Platform Admin).
- Problema resolvido.
- Resultado esperado.

### Personas

Use somente as relevantes:

- Merchant Owner
- Merchant Operator
- Buyer (comprador final)
- Platform Admin
- Finance / FinOps interno
- Support Agent
- Compute Provider (PLANNED)

### Rotas e navegação

| Rota | Tela | Persona | Permissão | Status |

### Estrutura da página

- Header.
- Sidebar.
- Breadcrumb.
- Cards.
- Tabelas.
- Gráficos.
- Filtros.
- Formulários.
- Modais.
- Drawers.
- Alertas.
- Paginação.
- Ações primárias e secundárias.

### Component tree

```
ModulePage
├── ModuleHeader
├── Filters
├── SummaryCards
├── DataTable
├── DetailsDrawer
└── ModuleAlerts
```

### Estados da interface

Documentar **obrigatoriamente**:

- Loading.
- Empty.
- Success.
- Partial data.
- Error.
- Permission denied.
- Rate limited.
- Provider unavailable (Shopify down, Asaas down).
- Offline.
- Stale data.
- Destructive action confirmation.

### Dados e integração

| Componente | Endpoint | Query/Mutation | Cache | Atualização |

### Formulários

- Campos.
- Validações.
- Valores padrão.
- Erros.
- Confirmações.
- Permissões.
- Prevenção de duplicidade.

### Design system

**Preserve** o design system existente em `apps/dashboard`:

- Tailwind + tokens.
- shadcn-style components.
- Paleta.
- Tipografia.
- Espaçamento.
- Dark mode.
- Componentes compartilhados.

> **Não invente** um novo design system.

### Responsividade

- Desktop.
- Tablet.
- Mobile.

### Acessibilidade

- Navegação por teclado.
- Focus states.
- Labels.
- ARIA.
- Contraste.
- Leitores de tela.

### Segurança da interface

- Não expor secrets.
- Não registrar API keys no navegador.
- Mascaramento (CPF, cartão).
- Confirmações destrutivas.
- Proteção de rotas.
- Expiração de sessão.
- Tenant ativo.

### Telemetria de produto

- Page views.
- Ações.
- Conversão.
- Erros.
- Tempo para completar tarefas.
- Features utilizadas.

### Critérios de aceite

```text
Given...
When...
Then...
```

### Evidências

Cite componentes, hooks, stores, services, páginas e testes reais.

---

## 9. Template obrigatório de `IMPLEMENTATION.md`

### Resumo do gap

- Estado atual (com referência ao status).
- Estado desejado.
- Diferença concreta.

### Estratégia de implementação

- Reutilizações.
- Alterações.
- Novos componentes.
- Migrations.
- Endpoints.
- Telas.
- Eventos.
- Infraestrutura.

### Backlog

| Ordem | Tarefa | Backend/Frontend/Infra | Dependência | Tamanho | Critério de aceite |
| ----: | ------ | ---------------------- | ----------- | ------- | ------------------ |

Cada tarefa deve mencionar:

- Arquivos envolvidos.
- Classes/componentes.
- Testes.
- Resultado esperado.
- Dependências.
- Riscos.

### Plano de testes

- Unit.
- Integration.
- E2E.
- Contract.
- Load.
- Security.
- Accessibility.
- Visual regression.

### Estratégia de rollout

- Feature flag.
- Shadow mode.
- Canary.
- Migração.
- Compatibilidade.
- Rollback.
- Observabilidade.

### Definition of Done

Checklist objetiva para o módulo ser considerado concluído.

---

## 10. Matriz geral — `docs/modules/IMPLEMENTATION_MATRIX.md`

| Módulo | Domínio | Backend | API | Frontend | Banco | Eventos | Testes | Observabilidade | Segurança | Produção |
| ------ | ------- | ------: | --: | -------: | ----: | ------: | -----: | --------------: | --------: | -------: |

Use percentuais só quando houver critério objetivo. Caso contrário, use os status padronizados.

Inclua também:

- Módulos bloqueadores.
- Quick wins.
- Módulos críticos para o MVP de produção.
- Dívidas técnicas (referência ao `CONCERNS.md`).
- Dependências circulares.
- Ordem recomendada.

---

## 11. Mapa de dependências — `docs/modules/DEPENDENCY_MAP.md`

- Context Map (Mermaid).
- Dependências síncronas (imports entre módulos —核对 `bounded-contexts.md`).
- Dependências assíncronas (eventos via `OutboxMessage`).
- Eventos.
- Bancos (tabelas compartilhadas entre contextos).
- Serviços externos.
- Frontend.
- SDKs / pacotes.

Identifique:

- Acoplamentos indevidos.
- Responsabilidades duplicadas.
- Dependências circulares.
- Shared kernels excessivos.
- Candidatos a serviços separados.

---

## 12. Jornadas do usuário — `docs/modules/USER_JOURNEYS.md`

Documente pelo menos:

1. Merchant cria conta e onboarding.
2. Merchant configura widget no Shopify.
3. Merchant cria Agent Rule.
4. Buyer acessa checkout conversacional.
5. Buyer aplica cupom.
6. Buyer recebe oferta personalizada.
7. Buyer paga via PIX (Asaas).
8. Merchant acompanha pedido.
9. Merchant configura shipping rules.
10. Merchant ativa negociação M2M.
11. Platform Admin investiga dispute.
12. Platform Admin audita eventos.
13. Buyer usa self-checkout.
14. Buyer usa WebAuthn / OTP.
15. Buyer solicita suporte.
16. AACP executa fallback determinístico (LLM indisponível).
17. AACP executa cross-sell pós-checkout.
18. AACP dispara webhook para Shopify.

Para cada jornada:

- Persona.
- Objetivo.
- Pré-condições.
- Telas.
- APIs.
- Módulos.
- Eventos.
- Falhas.
- Critério de sucesso.

---

## 13. Estratégia por lotes (preservada)

Trabalhe em lotes para não perder qualidade.

### Lote 1 — Fundação

- auth
- onboarding
- merchant
- buyer-account
- audit
- API Keys (`MerchantApiKey` — pode ficar em `auth/`)

### Lote 2 — Checkout Core

- checkout
- checkout-settings
- agent-rules
- fulfillment
- shipping
- shipping-engine
- catalog

### Lote 3 — Inteligência e Qualidade

- rules-engine
- decision-engine
- conversation-engine
- agent-rules (ja em Lote 2? confirme)
- buyer-purchase-history
- recomendation-engine
- cross-sell
- coupons

### Lote 4 — Negociação e Suporte

- negotiation
- negotiation-engine
- support
- self-checkout

### Lote 5 — Pagamentos e Comércio

- payment
- payment-crypto (`payments-evm`)
- commerce
- commerce-adapters
- integrations
- scraping-agent
- operations

### Lote 6 — Platform / Frontend / SDKs

- shared-types
- contracts
- agentic-checkout-js
- Dashboard Web (`apps/dashboard`)
- Widget Web (`apps/widget` — apenas referência cross-cutting)

### Lote 7 — Compute Network (PLANNED)

Todos os 25 módulos listados na seção 5.

### Lote 8 — Observabilidade, Rate Limit, Notifications

- observability
- rate-limit
- notifications
- (se criados ou movidos aqui)

> **Ao terminar cada lote:**
> 1. Revisar links.
> 2. Revisar evidências.
> 3. Verificar consistência de status.
> 4. Verificar duplicações com docs existentes (`docs/architecture/`).
> 5. Atualizar o índice mestre.
> 6. Atualizar a matriz de implementação.
> 7. Fazer um resumo do lote.
> 8. Continuar para o próximo sem implementar código.

---

## 14. Regras para frontend

Não desenhe telas sem necessidade comercial/operacional. Antes de propor:

- Quem usará?
- Qual decisão será tomada?
- Qual problema resolve?
- Existe tela atual que pode absorver?
- Pode ser seção ou drawer em vez de página?
- A ação pode ser feita por API ou CLI?

Priorizar inicialmente (alinhado a `.specs/features/dashboard-*-redesign`):

- Overview / Dashboard geral.
- Checkout Settings.
- Merchant Rules.
- Negotiation.
- Customers.
- Billing.
- Commerce Connections.
- Payment Connections.
- Embed.
- Integrations.
- Audit Log.
- Onboarding Wizard.
- Orders / Shipments.
- Support Settings.
- Preview.
- Theme.

Não transforme cada pequeno componente técnico em tela separada.

---

## 15. Regras para API

- Preserve compatibilidade dos endpoints públicos.
- Não quebre contratos existentes (Shopify webhook payloads, Asaas webhook payloads).
- Planeje versionamento (`/v1/`).
- Use idempotência (`HttpIdempotencyRecord`) para operações financeiras e de mutação.
- Preserve isolamento multi-tenant (`merchant_id` em todo query/command).
- Não exponha secrets.
- Padronize paginação (cursor/offset) e erros.
- Use `OutboxMessage` para efeitos assíncronos.
- Não crie microserviços sem justificativa.
- Não duplique metering ou billing.
- Reutilize schemas de `shared-types` e `contracts`.
- Documente diferenças entre endpoint real e planejado.

---

## 16. Resumo final obrigatório

Após criar os documentos, apresente:

1. Quantos módulos foram encontrados no código.
2. Quantos módulos estavam apenas documentados (em specs/ADRs).
3. Quantos módulos foram propostos para Compute Network.
4. Quantos documentos foram criados.
5. Quais módulos estão mais próximos da produção.
6. Quais módulos são somente scaffolding.
7. Os 10 maiores gaps de backend.
8. Os 10 maiores gaps de frontend.
9. Os 5 principais riscos arquiteturais.
10. A sequência recomendada de implementação.
11. Os módulos que devem permanecer no monólito.
12. Os componentes que justificam processo ou serviço separado.
13. Links para o índice, matriz e mapa de dependências.

---

## 17. Restrições finais

- **Não implemente código.**
- **Não altere comportamento do sistema.**
- **Não execute migrations.**
- **Não faça deploy.**
- **Não use dados de produção.**
- **Não exponha credenciais.**
- **Não invente evidências.**
- **Não marque documentação planejada como código existente.**
- **Não sobrescreva documentação útil** sem preservar conteúdo (`docs/architecture/adr/`, `.specs/`, `docs/architecture/bounded-contexts.md`).
- **Não crie números comerciais falsos.**
- **Não declare conformidade LGPD sem auditoria** — referência `.specs/features/lgpd-compliance`.
- **Não declare segurança completa sem threat model e testes.**
- **Não confunda teste unitário com prontidão para produção.**
- **Não pare para pedir autorização entre os lotes.**
- **Conclua toda a documentação e somente depois apresente o resumo.**

---

## Anexo — Auditoria inicial (ponto de partida)

> Use esta auditoria como ponto de partida. Atualize conforme evolui.

### Módulos reais no backend (`apps/api/src/modules/`)

```
agent-rules, audit, auth, buyer-account, buyer-purchase-history,
catalog, checkout, checkout-settings, commerce, coupons,
cross-sell, embed, fulfillment, installations, integrations,
merchant, negotiation, onboarding, operations, payment,
scraping-agent, self-checkout, shipping, support
```

### Pacotes (`packages/`)

```
agentic-checkout-js, commerce-adapters, contracts,
conversation-engine, decision-engine, negotiation-engine,
payments-evm, recomendation-engine, rules-engine,
shared-types, shipping-engine
```

### Tabelas Prisma principais (`apps/api/prisma/schema.prisma`)

Merchant: `Merchant`, `MerchantOnboardingState`, `MerchantInstallation`, `MerchantUser`, `MerchantApiKey`, `MerchantRule`, `MerchantWebhookEndpoint`, `MerchantWebhookDelivery`, `MerchantCommerceConnection`, `MerchantPaymentConnection`, `MerchantBillingSubscription`, `MerchantNegotiationPolicy`.

Checkout: `CheckoutSetting`, `CheckoutSession`, `CheckoutEvent`, `AuthorizedOffer`, `AcceptedOffer`, `CompletedOrder`, `CheckoutIntervention`.

Buyer: `BuyerIdentity`, `BuyerAccount`, `BuyerAddress`, `BuyerConversation`, `BuyerPreference`, `BuyerAgentProfile`, `BuyerAgentNegotiationPreference`, `BuyerPurchaseRecord`, `BuyerPhoneOtp`, `WebAuthnCredential`.

Support / Agent: `AgentRule`, `SupportSetting`, `SupportTicket`.

Commerce / Shipping: `CommercePendingOrder`, `CommercePaidEvent`, `Shipment`, `TrackingEvent`, `ShippingQuote`.

Payment: `PaymentIntent`, `PaymentProviderEvent`, `PaymentCryptoTransfer`.

Negotiation: `NegotiationSession`, `NegotiationCostLedgerEntry`.

Misc: `Coupon`, `CouponRedemption`, `CrossSellPromotion`, `CrossSellSuggestion`, `PriceQuoteJob`, `SelfCheckout*`, `OutboxMessage`, `OutboxHandlerExecution`, `HttpIdempotencyRecord`, `MerchantAuditEvent`, `LoginAttemptCounter`.

### Dashboard pages (`apps/dashboard/src/pages/`)

```
audit-log-page, billing-page, checkout-settings, commerce-connections-page,
customers-page, embed-page, integrations-page, merchant-rules-page,
negotiation, negotiation-page, onboarding-wizard, orders-shipments-page,
overview-demo-page, payment-connections-page, preview-page,
support-settings-page, theme-page
```

### Widget (`apps/widget/`)

Embed conversacional — não documentado módulo a módulo aqui; referenciar como cliente consumidor.

### Documentação existente a preservar

- `docs/architecture/bounded-contexts.md` — mapa oficial de contextos.
- `docs/architecture/adr/0001-0014` — decisões registradas.
- `docs/architecture/refactor-plan.md` — plano de refatoração.
- `.specs/codebase/STACK.md`, `TESTING.md`, `INTEGRATIONS.md`, `CONCERNS.md`.
- `.specs/audit/PRODUCTION_READINESS_AUDIT.md`.
- Cada feature em `.specs/features/<feature>/` com `spec.md`, `design.md`, `tasks.md`.