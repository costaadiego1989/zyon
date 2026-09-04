# Support Exchange/Return + Marketplace Handoff — Design

## Architecture Overview

```
STOREFRONT/WIDGET                API                          DASHBOARD
─────────────────                ───                          ─────────
[Return form]                    RequestReturnUseCase         [SupportChatDrawer]
  + image upload  ──POST────►    → creates Return             ← renders structured
                                 → creates/links Ticket          exchange card + images
  S3UploadService  ◄──presign──  → emits structured message
                                 → WS new_message (metadata)  [Partner dropdown]
                                                              → transferTicket
                                 TransferTicketUseCase   ◄────  (marketplace only)
                                 → change merchantId
                                 → audit + WS ticket_transferred
```

## Part 1: Structured Message (fix broken content)

### Schema change (additive, safe migration)

```prisma
model SupportTicketMessage {
  id         String   @id @default(cuid())
  ticketId   String   @map("ticket_id")
  senderType String   @map("sender_type")
  content    String
  metadata   Json?    @map("metadata")        // NEW: structured payload
  createdAt  DateTime @default(now()) @map("created_at")
  ticket SupportTicket @relation(...)
  @@index([ticketId, createdAt])
  @@map("support_ticket_messages")
}

model SupportTicket {
  // ... existing ...
  returnId   String?  @map("return_id")        // NEW: link to Return
  // ... transfer tracking ...
  originMerchantId String? @map("origin_merchant_id")  // NEW: who owned it first
  transferredAt    DateTime? @map("transferred_at")     // NEW
}
```

### Message metadata contract (shared-types)

```ts
// packages/shared-types
export type SupportMessageMetadata =
  | { kind: "text" }
  | {
      kind: "return_request";
      returnId: string;
      reason: ReturnReason;
      reasonLabel: string;          // "Produto com defeito"
      items: Array<{ name: string; variantId: string; quantity: number; imageUrl?: string }>;
      imageUrls: string[];          // buyer evidence
      orderRef?: string;
    }
  | {
      kind: "ticket_transferred";
      fromMerchantId: string;
      toMerchantId: string;
      toStoreName: string;
    };
```

- `content` stays as human-readable fallback (e.g. "Solicitação de troca: Produto com defeito"). Old clients render this.
- New clients read `metadata.kind` and render the rich card.

### Flow: return → ticket → structured message

`RequestReturnUseCase` (extended):
1. Create Return (unchanged core).
2. Resolve/create SupportTicket for (merchantId, buyerId/session) → link `returnId`.
3. Build `SupportMessageMetadata { kind: "return_request", ... }` from the Return.
4. Emit `SendTicketMessageUseCase` with `content` (fallback text) + `metadata`.
5. WS `new_message` carries metadata.

`SendTicketMessageUseCase` (extended):
- Accept optional `metadata?: SupportMessageMetadata`.
- Persist to new column. Return in DTO.

## Part 2: Image Upload + Display

### Upload (buyer side — storefront/widget)

- Reuse `S3UploadService.uploadBase64(dataUri, "returns")` (already exists).
- New endpoint: `POST /returns/upload-image` (multipart or base64) → returns `{ url }`.
  - Alternatively presigned URL. Decision: **base64 → server upload** (simpler, S3 service already has uploadBase64, no CORS/presign complexity for MVP).
- Buyer return form collects images → uploads → passes `imageUrls[]` to `RequestReturnUseCase`.
- Validation: max 5 images, max 5MB each, jpg/png/webp only.

### Display (agent side — dashboard)

- `SupportChatDrawer` message renderer: switch on `metadata.kind`.
  - `return_request` → `<ExchangeCard>`: reason badge, item list (thumbnail + name + qty), evidence gallery.
  - Gallery: thumbnail grid, click → lightbox (keyboard nav, alt text, lazy load).
- New component: `apps/dashboard/src/pages/support-settings/components/ExchangeCard.tsx`
- New component: `ImageGallery.tsx` + `Lightbox.tsx` (or reuse if exists).

## Part 3: Marketplace Partner Handoff

### Eligibility check

- Ticket is marketplace-origin if its linked Return's order has a `CrossStoreLineItem` (sellerMerchantId ≠ hostMerchantId).
- New query: given ticketId → returnId → orderId → CrossStoreLineItem[] → distinct sellerMerchantIds.
- If any exist → show "Vincular loja parceira" button.

### Partner store dropdown

- Data: `MarketplaceConnection` where `buyerMerchantId = currentMerchant AND status = "active"`.
- Join to seller merchant name (Merchant table) → `{ merchantId, storeName }`.
- New endpoint: `GET /marketplace/partner-stores?q=<search>` (tenant-scoped, searchable).
- UI: searchable dropdown (`PartnerStoreDropdown.tsx`) — filter client-side or server `q`.

### Transfer flow

`TransferTicketUseCase` (new):
```
execute({ ticketId, currentMerchantId, targetMerchantId }):
  1. Load ticket, assert currentMerchantId owns it (tenant boundary).
  2. Assert MarketplaceConnection exists (currentMerchant → target) status active.
  3. Update ticket: set originMerchantId (if null) = current, merchantId = target, transferredAt = now.
  4. Insert structured message { kind: "ticket_transferred", from, to, toStoreName }.
  5. Audit trail (existing audit module): actor=merchant, action=ticket.transfer.
  6. WS emit "ticket_transferred" to both merchant rooms.
```

- New endpoint: `POST /support/tickets/:id/transfer` body `{ targetMerchantId }`.
- WS gateway: add `ticket_transferred` event (join_merchant rooms).

### Tenant boundary (critical)

- Transfer only allowed to a merchant with an **active MarketplaceConnection** from the current merchant.
- After transfer, original merchant no longer owns (queries scoped by merchantId won't return it) — but `originMerchantId` preserved for audit/history.
- All new queries scoped by merchantId. No cross-merchant data leak.

## Component Map

### API (new/changed)
| File | Change |
|------|--------|
| prisma/schema.prisma | +metadata, +returnId, +originMerchantId, +transferredAt |
| returns/.../request-return.use-case.ts | link ticket + emit structured msg |
| support/.../send-ticket-message.use-case.ts | accept metadata |
| support/.../transfer-ticket.use-case.ts | NEW |
| support/.../list-partner-stores.use-case.ts | NEW |
| returns/.../upload-return-image.use-case.ts | NEW (wraps S3UploadService) |
| support/presentation/http/support-messages.controller.ts | +transfer endpoint |
| marketplace/.../partner-stores.controller.ts | +GET partner-stores |
| support/infrastructure/gateways/support.gateway.ts | +ticket_transferred event |
| packages/shared-types | +SupportMessageMetadata |

### Dashboard (new/changed)
| File | Change |
|------|--------|
| pages/support-settings/components/SupportChatDrawer.tsx | render metadata cards |
| .../components/ExchangeCard.tsx | NEW |
| .../components/ImageGallery.tsx + Lightbox.tsx | NEW |
| .../components/PartnerStoreDropdown.tsx | NEW |
| hooks/useSupportSocket.ts | handle ticket_transferred, metadata in TicketMessage |
| api/endpoints/support.ts | +transferTicket, +listPartnerStores |
| api/types.ts | +metadata on TicketMessage |

### Storefront/Widget (new/changed)
| File | Change |
|------|--------|
| return form component | +image upload UI |
| api client | +uploadReturnImage |

## SOLID / Conventions
- Use-cases verb-named, thin controllers, ports for repos.
- metadata is a typed union in shared-types (single source of truth).
- Image upload delegates to existing S3UploadService (DIP, no new storage code).
- Backward compatible: metadata null → text render.

## Migration Safety
- All columns nullable/additive → no data backfill needed.
- `prisma migrate dev` → additive migration.
- Old messages: metadata null → render as text (kind:"text" default).

## Testing Strategy
- Unit: TransferTicketUseCase (tenant boundary, connection check), RequestReturn→ticket link, metadata build.
- Unit: partner-stores query scoping.
- Component: ExchangeCard renders reason/items/images; PartnerStoreDropdown search.
- E2E: buyer opens return with image → agent sees card → transfers to partner → partner sees ticket.
- Gate: api pnpm typecheck+test, dashboard typecheck+build.

## Open Decisions (resolved)
- ✅ Images: buyer upload (base64 → S3UploadService).
- ✅ Dropdown: only marketplace-origin tickets.
- ✅ Transfer: change ownership + notify + audit.
