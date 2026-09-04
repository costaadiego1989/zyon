# Tasks: Human Handoff — Live Chat

## T1: Schema + Migration [P]
- Add `SupportTicketMessage` model to prisma schema
- Add `messages` relation to `SupportTicket`
- Generate migration SQL
- Run `prisma:generate`
- **Done when:** `pnpm typecheck` passes, model available in client

## T2: Use-cases (send + list messages) [P]
- Create `send-ticket-message.use-case.ts` — validates ticket exists, creates message, returns DTO
- Create `list-ticket-messages.use-case.ts` — paginated by ticketId (cursor or offset)
- **Done when:** unit-testable use-cases, typecheck passes

## T3: REST Controller for messages
- `GET /support/tickets/:id/messages` — returns paginated messages
- `POST /support/tickets/:id/messages` — merchant sends message (guarded by tenant access)
- **Depends on:** T1, T2
- **Done when:** API typecheck, endpoints callable

## T4: Support WebSocket Gateway
- New `SupportGateway` on namespace `/support`
- Events: `join_merchant` (joins room `merchant:{merchantId}`), `join_ticket`, `send_message`, `leave_ticket`
- On message received: call use-case → emit `new_message` to ticket room + buyer room
- On new ticket: emit `new_ticket` to merchant room
- **Depends on:** T2
- **Done when:** Gateway registered in module, typecheck passes

## T5: Fix escalate_to_human in storefront adapter
- Inject `SupportHandoffService` into `StorefrontConversationAdapter`
- Replace fake ticket ID with `handoff.execute()` call
- After ticket created: emit `handoff_started` to buyer's socket room + `new_ticket` to merchant room
- **Depends on:** T4
- **Done when:** Real ticket appears in DB when buyer says "falar com humano"

## T6: Dashboard — useSupportSocket hook
- Connect to `/support` namespace (socket.io-client)
- Auto-join `merchant:{merchantId}` on mount
- Expose: `joinTicket(id)`, `sendMessage(ticketId, content)`, `onNewTicket(cb)`, `onNewMessage(cb)`
- Reconnect logic
- **Depends on:** T4
- **Done when:** Hook importable, typecheck passes

## T7: Dashboard — SupportChatDrawer component
- Right-side slide-over (~400px)
- Props: `ticketId`, `onClose`
- Loads messages via REST on open
- Subscribes to `new_message` via socket
- Textarea + send button
- Auto-scroll to bottom on new message
- Status badge + resolve/close actions
- **Depends on:** T3, T6
- **Done when:** Drawer renders, sends/receives messages

## T8: Dashboard — Wire drawer into support page
- Ticket row click → opens `SupportChatDrawer`
- New ticket toast notification on `new_ticket` event
- Badge counter on nav item (optional v1)
- **Depends on:** T7
- **Done when:** Click ticket → drawer opens with chat

## T9: Widget — handle merchant_reply
- In `use-support-chat.ts`: listen for `merchant_reply` socket event
- Add message to chat with senderType "merchant" and label "Atendente"
- Allow buyer to continue typing → emits `buyer_reply`
- **Depends on:** T4, T5
- **Done when:** Buyer sees merchant message in widget chat

## T10: Storefront — handle merchant_reply
- In `SupportPanel.tsx` or conversation hook: listen for `merchant_reply`
- Render as "Atendente" message
- Buyer reply → emit `buyer_reply` to socket
- **Depends on:** T4, T5
- **Done when:** Same as T9 but in storefront

## Execution Order
```
T1 ──┐
     ├── T2 ── T3 ── T7 ── T8
T1 ──┘         │
               T4 ── T5 ── T9
               │           T10
               T6 ── T7
```

Parallelizable: T1+T2 (schema + use-cases), T9+T10 (widget + storefront)
