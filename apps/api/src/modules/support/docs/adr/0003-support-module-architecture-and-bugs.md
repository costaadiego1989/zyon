# ADR 0003 (support) — Arquitetura do módulo support e correções de boundary/validação

- **Status:** proposto
- **Data:** 2026-06-18
- **Decisores:** Engenharia (Support), Segurança, Plataforma
- **Relacionado:** [ADR 0003](../../../../../../../docs/architecture/adr/0003-event-bus-and-transactional-outbox.md), [ADR 0005](../../../../../../../docs/architecture/adr/0005-multi-tenant-isolation.md), [ADR 0009](../../../../../../../docs/architecture/adr/0009-platform-p0-hardening.md), [ADR 0012](../../../../../../../docs/architecture/adr/0012-embed-security-hardening.md), [ADR 0017](../../../../../../../docs/architecture/adr/0017-integrations-api-keys-webhooks.md), [ADR 0019](../../../../../../../docs/architecture/adr/0019-negotiation-and-support.md). Código: `apps/api/src/modules/support/**`.

## Contexto

`support` atende dois públicos por um único `SupportController` (`presentation/http/support.controller.ts`):

- **Widget (buyer-facing):** `POST /support/chat` e `GET /support/faq`. Hoje **sem guard** e com `merchant_id` vindo do `@Body()`/`@Query()`.
- **Console (operator-facing):** `GET/PUT /support/settings`, `GET/POST /support/tickets`, `PATCH /support/tickets/:id`, todos atrás de `TenantCredentialGuard` + `TenantAccessGuard` com `serviceScopes` (`support:read`/`support:write`) e `@Idempotent()` nas mutações.

Camadas (hexagonal, ADR 0001/0002):
- **Application:** `SendSupportMessageUseCase` (FAQ lookup determinístico → LLM com `BASE_SYSTEM_PROMPT` restritivo → validação `isSafeGeneratedMessage` → fallback determinístico → handoff/ticket), `GetSupportSettingsUseCase`, `UpdateSupportSettingsUseCase`, `CreateSupportTicketUseCase`, `ListSupportTicketsUseCase`, `UpdateSupportTicketStatusUseCase`.
- **Domain:** `SupportTicketEntity`, `SupportSettingsEntity`, ports `SupportTicketRepository`, `SupportSettingsRepository`.
- **Infrastructure:** repositórios Prisma (`support_tickets`, `support_settings`) e in-memory; publisher `support.ticket.created` via `TenantWebhookPublisher` (ADR 0017).

**Invariantes que o módulo deve sustentar:**
1. Todo comando/consulta é escopado por um `merchant_id` **autenticado** (CLAUDE.md, ADR 0005/0009) — nunca por valor do cliente.
2. O LLM **nunca** autoriza desconto/cupom/pagamento/estoque; resposta gerada passa por `isSafeGeneratedMessage` com fallback determinístico (ADR 0019).
3. Leitura não muta persistência.
4. Entrada validada/whitelisted pelo `ValidationPipe` global (ADR 0009).
5. Notificação (webhook) é desacoplada do caminho de request (ADR 0003).

## Decisão

Manter a separação widget/console, mas **fechar o boundary de tenant no caminho widget** e alinhar validação/persistência às invariantes. Concretamente:

- `POST /support/chat` e `GET /support/faq` passam a derivar a identidade do merchant de um **token de sessão de embed verificado** (mesmo mecanismo do módulo `embed`, ADR 0012), rejeitando requests cujo tenant do token divirja. `merchant_id` sai do shape de entrada do cliente.
- Rotas de console permanecem atrás de `TenantCredentialGuard`/`TenantAccessGuard`.
- Entrada do chat vira DTO validado (`class-validator`), não interface TS.
- `GetSupportSettings` deixa de persistir no caminho de leitura.
- Lista de tickets ganha paginação por keyset real; webhook de handoff/criação é desacoplado.

## Bugs encontrados e remediação decidida

### P0 — Endpoints widget confiam em `merchant_id` do cliente, sem auth (boundary de tenant)
- **Arquivo:** `presentation/http/support.controller.ts:50-62`.
- **Causa raiz:** `chat()` e `getFaq()` não têm guard (guards só nas rotas de settings/tickets) e derivam o tenant de `body.merchant_id` / `@Query('merchant_id')`. `SupportMessageInput` é interface TS, então `merchant_id` é controlado pelo atacante. O handoff persiste/consulta sob esse id (`getSettings.execute(body.merchant_id)`, `createHandoff` com `input.merchant_id`).
- **Impacto:** leitura cross-tenant não autenticada de FAQ/settings, tickets forjados atribuídos a qualquer merchant, e writes sob `merchant_id` arbitrário. Quebra direta da invariante 1.
- **Remediação:** derivar merchant do token de embed verificado; rejeitar divergência token↔tenant; remover `merchant_id` do shape de entrada. **Precisa de mudança de contrato** (corpo de `/support/chat` e query de `/support/faq` perdem `merchant_id`; passa a exigir token de embed). Sem migração de schema.

### P1 — Corpo do chat é interface, não DTO validado (sem whitelist, input LLM ilimitado)
- **Arquivo:** `application/send-support-message.use-case.ts:12-16`.
- **Causa raiz:** `SupportMessageInput` usado como `@Body()` é interface TS sem metadados `class-validator`; o `ValidationPipe` global (`whitelist`/`forbidNonWhitelisted`) não consegue restringir. `message` sem `MaxLength`; campos extras passam; texto é encaminhado verbatim ao OpenAI.
- **Impacto:** comprimento ilimitado gera blow-up de token/custo e DoS contra o orçamento do LLM; campos não-whitelisted furam a política de validação estrita. Com o endpoint sem auth, é remotamente abusável.
- **Remediação:** criar `SupportChatDto` com `@IsString/@MinLength/@MaxLength` em `message` e `session_id` opcional limitado; remover `merchant_id` do shape (deriva do token); confiar no `ValidationPipe` global. **Precisa de mudança de contrato** (shape do corpo). Sem migração.

### P1 — `GetSupportSettings` faz write-on-read (salva linha default) para qualquer `merchant_id`
- **Arquivo:** `application/get-support-settings.use-case.ts:16-20`.
- **Causa raiz:** `execute()` salva `SupportSettingsEntity.createDefault(...)` quando não existe. É chamado do caminho não autenticado de chat/faq com `merchant_id` do cliente, então uma leitura muta persistência e cria linhas `support_settings` para ids arbitrários/inexistentes.
- **Impacto:** amplificação de escrita e linhas-lixo para ids escolhidos pelo atacante numa leitura não autenticada; polui dados de tenant e storage. Surfaceia o bug de boundary como vetor de escrita. Quebra invariante 3.
- **Remediação:** retornar default em memória sem persistir na leitura; só persistir via `PUT /support/settings` autenticado. Combinar com o fix de auth (P0) para que `merchant_id` seja sempre tenant verificado. Não precisa de contrato nem migração.

### P2 — Lista de tickets travada em 100, `has_more` sempre false e `next_cursor` null
- **Arquivo:** `infrastructure/prisma-support-ticket.repository.ts:83-99`.
- **Causa raiz:** `list()` emite `LIMIT 100` fixo sem cursor; o controller `getTickets()` sempre retorna `next_cursor: null, has_more: false`. O envelope de paginação anuncia completude que a query não entrega.
- **Impacto:** merchants com mais de 100 tickets nunca veem os mais antigos; `has_more=false` engana clientes. Tickets ficam inalcançáveis.
- **Remediação:** paginação por keyset `(created_at, id)` na assinatura `repository.list`, espelhando `operations.page()`/`AuditCursor`; controller emite `next_cursor`/`has_more` reais. **Precisa de mudança de contrato** (envelope de `/support/tickets` ganha cursor funcional; `list` muda assinatura). Sem migração (índice `(merchant_id, created_at, id)` recomendado).

### P2 — Publish de webhook no handoff/create é desprotegido — falha do webhook quebra o chat após o ticket persistir
- **Arquivo:** `application/send-support-message.use-case.ts:189-203`.
- **Causa raiz:** `createHandoff` faz `await this.webhooks.publish(...)` logo após salvar o ticket, sem try/catch. `CreateSupportTicketUseCase.publishCreated` tem o mesmo padrão. Erro do publisher propaga e 500a o request mesmo com o ticket já commitado.
- **Impacto:** falha transitória de webhook quebra a resposta do chat do comprador e pode disparar retries que criam tickets duplicados, apesar do ticket persistido. Quebra invariante 5.
- **Remediação:** desacoplar notificação do request — emitir via outbox transacional (ADR 0003), ou envolver `publish` em try/catch com métrica/log para que a resposta com o ticket persistido sempre retorne. Não precisa de contrato; alinhamento com ADR 0003 (outbox) é o alvo durável.

## Melhorias para produção

### Segurança
- Identidade do widget via token de embed verificado (ADR 0012); `merchant_id` nunca do cliente (ADR 0005/0009). Console atrás de `TenantCredentialGuard`/`TenantAccessGuard` por escopo. Rate limit nas rotas widget.

### Desacoplamento
- Notificação `support.ticket.created` via outbox durável (ADR 0003/0017), fora do caminho de request.

### Persistência & Consistência
- Leitura sem efeito colateral (default em memória); settings só via PUT autenticado; keyset pagination de tickets.

### Observabilidade
- Logs com `correlation_id` + `merchant_id` + `session_id`; métricas de mensagens, fallback acionado, handoffs e falhas de publish.

### Otimização & Escala
- `MaxLength` na mensagem do chat; cap de itens de FAQ no prompt (já `slice(0,10)`); índice `(merchant_id, created_at, id)` em `support_tickets`.

### Features faltantes
- SLA/roteamento de tickets; runbook de replay de `support.ticket.created`; rate limit por sessão de embed.

## Alternativas consideradas
- **Manter `merchant_id` no body com validação de formato.** Rejeitado: formato válido não prova posse do tenant; só token verificado fecha o boundary.
- **DTO sem remover `merchant_id`.** Rejeitado: mantém o vetor cross-tenant.
- **Persistir settings default na leitura por conveniência.** Rejeitado: viola "leitura não muta" e amplifica escrita sob id não confiável.

## Consequências
**Positivas:** boundary de tenant fechado no widget; validação estrita; paginação honesta; chat resiliente a falha de webhook.
**Negativas/riscos:** mudança de contrato nas rotas widget (corpo/query) exige atualização do SDK/widget; introdução de keyset muda a assinatura do repositório e o envelope de tickets.

**Barra de aceite:** chat/faq exigindo token de embed válido com teste cross-tenant negado; `SupportChatDto` rejeitando payload acima do limite e campos extras; leitura de settings sem write em banco real; paginação de tickets com `next_cursor`/`has_more` verdes; falha de webhook não 500a o chat (ticket persistido retornado).
