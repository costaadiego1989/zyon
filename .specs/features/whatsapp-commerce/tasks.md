# WhatsApp Commerce — Tasks Breakdown

**Created:** 2026-08-21
**Total:** 12 tasks (Phase 1 MVP)
**Estimate:** ~3-4 days parallelized

---

## Phase 1: MVP (Text Commerce via WhatsApp)

### T-WA-001: Prisma Schema + Migration
- **What:** Add `WhatsAppChannelConfig` + `WhatsAppSession` models
- **Where:** `apps/api/prisma/schema.prisma`
- **Depends on:** Nothing
- **Done when:** `prisma generate` + `prisma migrate dev` succeed
- **Gate:** Schema valid, no relation errors

### T-WA-002: WhatsApp Channel Module Skeleton
- **What:** Create module structure with empty controller + use cases
- **Where:** `apps/api/src/modules/whatsapp-channel/`
- **Depends on:** T-WA-001
- **Structure:**
  ```
  whatsapp-channel/
    domain/
      ports/whatsapp-sender.port.ts
      ports/whatsapp-session-repository.port.ts
      ports/whatsapp-config-repository.port.ts
    application/
      use-cases/handle-incoming-message.use-case.ts
      use-cases/handle-status-update.use-case.ts
      use-cases/route-to-session.use-case.ts
      use-cases/send-whatsapp-response.use-case.ts
      services/whatsapp-menu-renderer.service.ts
      services/message-debouncer.service.ts
    infrastructure/
      adapters/bubblewhats-sender.adapter.ts
      repositories/prisma-whatsapp-session.repository.ts
      repositories/prisma-whatsapp-config.repository.ts
    presentation/
      http/whatsapp-webhook.controller.ts
    whatsapp-channel.module.ts
  ```
- **Done when:** Module compiles, registered in AppModule
- **Gate:** `pnpm typecheck`

### T-WA-003: Webhook Controller
- **What:** `POST /webhooks/bubblewhats/messages` + `POST /webhooks/bubblewhats/status`
- **Where:** `whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts`
- **Depends on:** T-WA-002
- **Acceptance:**
  - Validates webhook secret (header or query param)
  - Drops `isGroup: true`
  - Drops `fromMe: true` (via messageContext)
  - Returns 200 immediately
  - Queues processing async (or inline for MVP)
- **Gate:** `pnpm typecheck` + manual curl test

### T-WA-004: Device-to-Merchant Config Repository
- **What:** CRUD for `WhatsAppChannelConfig` (deviceId ↔ merchantId)
- **Where:** `infrastructure/repositories/prisma-whatsapp-config.repository.ts`
- **Depends on:** T-WA-001
- **Done when:** `findByDeviceId(deviceId)` returns config or null
- **Gate:** Unit test

### T-WA-005: Session Router (RouteToSessionUseCase)
- **What:** Map `fromNumber + deviceId → WhatsAppSession → CheckoutSession`
- **Where:** `application/use-cases/route-to-session.use-case.ts`
- **Depends on:** T-WA-002, T-WA-004
- **Logic:**
  1. `deviceId` → resolve `merchantId` via config repo
  2. Find active WhatsAppSession by `[merchantId, buyerPhone]`
  3. If not found → create new CheckoutSession (reuse StartCheckoutUseCase) + WhatsAppSession
  4. If found but expired (>24h) → close old, create new
  5. Return `{ whatsappSession, checkoutSession }`
- **Done when:** Creates session on first msg, reuses on second
- **Gate:** Unit test

### T-WA-006: Numbered Menu Renderer
- **What:** Convert `quickReplies[]` → numbered text, resolve numbers → text
- **Where:** `application/services/whatsapp-menu-renderer.service.ts`
- **Depends on:** Nothing (pure function)
- **API:**
  ```typescript
  renderMenu(replies: string[], title?: string): string
  resolveInput(input: string, currentOptions: string[]): ResolvedInput
  // ResolvedInput = { text: string, action: "select"|"back"|"more"|"freetext" }
  ```
- **Rules:**
  - "0" → back
  - "1"-"10" → select option at index
  - Free text → pass through to engine
  - Returns formatted string: `[1] Option\n[2] Option\n...\n[0] Voltar`
- **Done when:** All cases pass
- **Gate:** Unit test (pure logic, easy to test)

### T-WA-007: Message Debouncer (5s batch)
- **What:** Accumulate messages within 5s window per session, process once
- **Where:** `application/services/message-debouncer.service.ts`
- **Depends on:** Nothing
- **Logic:**
  - First msg → start 5s timer
  - Subsequent msgs in window → append to buffer
  - Timer fires → concatenate buffer → emit for processing
  - Uses `Map<sessionId, { buffer: string[], timer: NodeJS.Timeout }>`
- **Done when:** 3 msgs in 2s produce 1 concatenated output after 5s
- **Gate:** Unit test with fake timers

### T-WA-008: Handle Incoming Message (Main Pipeline)
- **What:** Orchestrate: route → debounce → resolve menu → engine → render → send
- **Where:** `application/use-cases/handle-incoming-message.use-case.ts`
- **Depends on:** T-WA-005, T-WA-006, T-WA-007
- **Flow:**
  1. Route message to session
  2. Add to debounce buffer
  3. On debounce flush:
     a. Resolve numbered input if applicable
     b. Call `send-chat-message.use-case` with resolved text
     c. Get response + quickReplies
     d. Render menu (WhatsAppMenuRenderer)
     e. Save currentOptions to WhatsAppSession
     f. Send response via BubbleWhats
- **Done when:** End-to-end: webhook → engine → WhatsApp reply
- **Gate:** Integration test

### T-WA-009: BubbleWhats Sender Adapter
- **What:** Send text messages back via BubbleWhats API
- **Where:** `infrastructure/adapters/bubblewhats-sender.adapter.ts`
- **Depends on:** Nothing (HTTP call)
- **API:** `send(toNumber: string, text: string, deviceId: string): Promise<{ messageId: string }>`
- **Note:** Check if we already have a BubbleWhats send adapter elsewhere (reuse!)
- **Gate:** Manual test with real device

### T-WA-010: Status Update Handler
- **What:** Process delivery/read status webhooks
- **Where:** `application/use-cases/handle-status-update.use-case.ts`
- **Depends on:** T-WA-003
- **Logic:** Parse status code (0-5), log for analytics. No user-facing action.
- **Gate:** Unit test

### T-WA-011: Dashboard Config Page
- **What:** Merchant configures WhatsApp channel (device, toggle, test)
- **Where:** `apps/dashboard/src/pages/whatsapp-config/`
- **Depends on:** T-WA-004 (API endpoints)
- **UI:**
  - SectionHeader "WhatsApp Commerce"
  - Toggle "Ativar canal WhatsApp"
  - Input: Device ID (BubbleWhats)
  - Readonly: Webhook URL (auto-generated)
  - Button: "Testar conexão"
  - KPIs: conversas ativas, taxa de conversão
- **Gate:** `pnpm typecheck`

### T-WA-012: Wire Module + Register Routes
- **What:** Register WhatsAppChannelModule in AppModule, configure webhook route without auth guard
- **Where:** `apps/api/src/app.module.ts` + module file
- **Depends on:** T-WA-002 through T-WA-010 complete
- **Notes:**
  - Webhook endpoint needs NO auth guard (BubbleWhats calls it)
  - Authenticate via `webhookSecret` header instead
  - Status endpoint same (no auth, verify secret)
- **Gate:** `pnpm typecheck` + `pnpm build`

---

## Execution Order

```
Week 1 (parallel):
  [P] T-WA-001 (schema) ← START HERE
  [P] T-WA-006 (menu renderer — pure function)
  [P] T-WA-007 (debouncer — pure function)
  [S] T-WA-002 (skeleton — after T-WA-001)
  [S] T-WA-004 (config repo — after T-WA-001)
  [S] T-WA-003 (controller — after T-WA-002)
  [S] T-WA-005 (router — after T-WA-002 + T-WA-004)
  [P] T-WA-009 (sender adapter — independent)
  [P] T-WA-010 (status handler — simple)

Week 2 (integration):
  [S] T-WA-008 (main pipeline — after T-WA-005, 006, 007)
  [P] T-WA-011 (dashboard — after T-WA-004)
  [S] T-WA-012 (wire + final integration)
```

---

## Dependency Graph

```
T-WA-001 (schema)
  ├── T-WA-002 (skeleton)
  │     ├── T-WA-003 (controller)
  │     └── T-WA-005 (router)
  │           └── T-WA-008 (pipeline) ← MAIN
  └── T-WA-004 (config repo)
        ├── T-WA-005 (router)
        └── T-WA-011 (dashboard)

T-WA-006 (renderer) ──┐
T-WA-007 (debouncer) ─┼── T-WA-008 (pipeline)
T-WA-009 (sender) ────┘

T-WA-010 (status) ── standalone
T-WA-012 (wire) ── after ALL
```

---

## Success Criteria

**End of Phase 1:**
- [ ] Merchant configures deviceId no dashboard
- [ ] Buyer envia "oi" no WhatsApp → recebe menu numerado
- [ ] Buyer navega catálogo por números → adiciona ao carrinho
- [ ] Buyer finaliza → dados coletados por chat
- [ ] Link de pagamento enviado → buyer paga → confirmação no WhatsApp
- [ ] Fee cobrado em toda transação
- [ ] `pnpm typecheck` + `pnpm build` pass

---

## Phase 2 (Future — não implementar agora)

- T-WA-013: Audio transcription (Whisper)
- T-WA-014: Product images as media messages
- T-WA-015: Human handoff
- T-WA-016: Multi-device support
- T-WA-017: Rich text formatting (*bold*, _italic_)
