# Design: Human Handoff — Live Chat

## Architecture Overview

```
Buyer (widget/storefront)           API (NestJS)              Dashboard (React)
       │                                │                          │
       │ ── socket.io /storefront ────► │                          │
       │                                │ ◄── socket.io /support ──│
       │                                │                          │
       │  "falar com humano"            │                          │
       │ ──── message ─────────────────►│                          │
       │                                │ escalate_to_human tool   │
       │                                │ → SupportHandoffService  │
       │                                │ → create SupportTicket   │
       │                                │ → create initial Message │
       │                                │ → emit new_ticket ──────►│ (toast + badge)
       │ ◄─── handoff_started ─────────│                          │
       │  "Chamado aberto #xxx"         │                          │
       │                                │                          │
       │                                │    merchant opens drawer │
       │                                │ ◄── join_ticket ─────────│
       │                                │ ◄── GET /tickets/:id/msg │
       │                                │                          │
       │                                │ ◄── send_message ────────│
       │                                │ → create TicketMessage   │
       │ ◄─── merchant_reply ──────────│                          │
       │  renderiza como "Atendente"    │                          │
       │                                │                          │
       │ ── buyer_reply ───────────────►│                          │
       │                                │ → create TicketMessage   │
       │                                │ ── new_message ─────────►│ (drawer update)
```

## Data Model

### New: SupportTicketMessage
```prisma
model SupportTicketMessage {
  id         String   @id @default(cuid())
  ticketId   String   @map("ticket_id")
  senderType String   @map("sender_type")  // "buyer" | "merchant"
  content    String
  createdAt  DateTime @default(now()) @map("created_at")

  ticket SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  @@index([ticketId, createdAt])
  @@map("support_ticket_messages")
}
```

### Update: SupportTicket
Add relation: `messages SupportTicketMessage[]`

## Components

### API

1. **SupportGateway** (`/support` namespace)
   - `join_ticket` — merchant joins room `ticket:{id}`
   - `send_message` — merchant sends, persists, emits to buyer
   - `leave_ticket` — cleanup
   - On new ticket → emit `new_ticket` to merchant room `merchant:{merchantId}`

2. **SupportMessageController**
   - `GET /support/tickets/:id/messages` — paginated message list
   - `POST /support/tickets/:id/messages` — REST fallback for send

3. **Fix `escalate_to_human`**
   - Inject `SupportHandoffService` into storefront conversation adapter
   - Call `handoff.execute()` instead of returning fake ID
   - Emit `handoff_started` to buyer socket room

### Dashboard

4. **SupportChatDrawer**
   - Slide-over panel (right side, ~400px wide)
   - Header: ticket ID + status badge + close button
   - Body: message list (scrollable, auto-scroll to bottom)
   - Footer: textarea + send button
   - WebSocket connection to `/support` namespace

5. **useSupportSocket hook**
   - Connects to `/support` namespace
   - Joins `merchant:{merchantId}` room on mount
   - Exposes: `newTickets$`, `joinTicket()`, `sendMessage()`, `onMessage()`

### Widget/Storefront

6. **Receive merchant reply**
   - Listen for `merchant_reply` event in existing socket connection
   - Render message with "Atendente" badge instead of AI badge
   - Continue allowing buyer to type (goes as `buyer_reply`)

## Key Files to Modify

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add SupportTicketMessage model + relation |
| `apps/api/src/modules/support/support.module.ts` | Register gateway + message controller |
| `apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts` | NEW — WebSocket gateway |
| `apps/api/src/modules/support/presentation/http/support-messages.controller.ts` | NEW — REST endpoints |
| `apps/api/src/modules/support/application/send-ticket-message.use-case.ts` | NEW — persist + emit |
| `apps/api/src/modules/support/application/list-ticket-messages.use-case.ts` | NEW — paginated list |
| `apps/api/src/modules/storefront/infrastructure/adapters/storefront-conversation.adapter.ts` | Fix escalate_to_human |
| `apps/dashboard/src/pages/support-settings-page.tsx` | Add drawer trigger on ticket click |
| `apps/dashboard/src/components/SupportChatDrawer.tsx` | NEW — drawer component |
| `apps/dashboard/src/hooks/useSupportSocket.ts` | NEW — socket hook |
| `apps/widget/src/hooks/use-support-chat.ts` | Handle merchant_reply |
| `apps/storefront/src/components/SupportPanel.tsx` | Handle merchant_reply |
