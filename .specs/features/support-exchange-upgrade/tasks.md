# Support Exchange/Return + Marketplace Handoff — Tasks

## Phase 0: Foundation (schema + types)

### T0.1: Prisma migration + shared-types
**What:**
- Add `metadata Json?` to SupportTicketMessage
- Add `returnId String?`, `originMerchantId String?`, `transferredAt DateTime?` to SupportTicket
- Add `SupportMessageMetadata` union to packages/shared-types

**Where:** apps/api/prisma/schema.prisma, packages/shared-types/src/*
**Depends:** None
**Done when:** migration created + applied (dev), types exported
**Gate:** `pnpm prisma:generate` + `pnpm typecheck` (api + shared-types)

---

## Phase 1: API — structured messages + return→ticket link

### T1.1: Extend SendTicketMessageUseCase with metadata
**What:** accept optional `metadata: SupportMessageMetadata`, persist to new column, return in DTO.
**Where:** support/application/send-ticket-message.use-case.ts + list-ticket-messages.use-case.ts (return metadata)
**Depends:** T0.1
**Done when:** metadata persisted + returned; text-only still works (null)
**Gate:** `pnpm test -- send-ticket-message` + typecheck

---

### T1.2: Link return → ticket + emit structured message
**What:** RequestReturnUseCase resolves/creates a SupportTicket, links returnId, builds return_request metadata, emits message via SendTicketMessage.
**Where:** returns/application/use-cases/request-return.use-case.ts (+ inject support use-case or a domain event)
**Depends:** T0.1, T1.1
**Reuses:** CreateSupportTicketUseCase, SendTicketMessageUseCase
**Done when:** creating a return creates/links a ticket with a return_request message (reason, items, imageUrls)
**Gate:** `pnpm test -- request-return` + typecheck

---

### T1.3: Return image upload endpoint
**What:** POST /returns/upload-image (base64 or multipart) → S3UploadService.uploadBase64(dataUri,"returns") → { url }. Validate type/size/count.
**Where:** returns/application/use-cases/upload-return-image.use-case.ts + returns controller
**Depends:** T0.1
**Reuses:** apps/api/src/shared/storage/s3-upload.service.ts
**Done when:** endpoint returns S3 url; validates jpg/png/webp, ≤5MB, ≤5 files
**Gate:** `pnpm test -- upload-return-image` + typecheck

---

## Phase 2: API — marketplace handoff

### T2.1: List partner stores query
**What:** GET /marketplace/partner-stores?q= → MarketplaceConnection(buyerMerchantId=current, active) joined to Merchant name. Tenant-scoped.
**Where:** marketplace module use-case + controller
**Depends:** T0.1
**Done when:** returns [{ merchantId, storeName }], filtered by q, scoped by current merchant
**Gate:** `pnpm test -- partner-stores` + typecheck

---

### T2.2: TransferTicketUseCase
**What:** transfer ticket ownership to partner (assert ownership + active connection), set originMerchantId/transferredAt, insert ticket_transferred message, audit, WS emit.
**Where:** support/application/transfer-ticket.use-case.ts + POST /support/tickets/:id/transfer
**Depends:** T0.1, T1.1
**Reuses:** audit module, support gateway
**Done when:** ownership changes only with valid connection; audit written; tenant boundary enforced
**Gate:** `pnpm test -- transfer-ticket` (incl. boundary rejection) + typecheck

---

### T2.3: WS ticket_transferred event + marketplace-origin check
**What:**
- support.gateway.ts: emit ticket_transferred to both merchant rooms
- query: isMarketplaceOrigin(ticketId) via returnId→orderId→CrossStoreLineItem
**Where:** support/infrastructure/gateways/support.gateway.ts + a query use-case
**Depends:** T2.2
**Done when:** event emitted; origin check returns seller merchant ids
**Gate:** typecheck + `pnpm test`

---

## Phase 3: Dashboard — rich rendering + handoff UI

### T3.1: TicketMessage metadata + socket handling
**What:** api/types.ts add metadata; useSupportSocket handle ticket_transferred; endpoints add transferTicket + listPartnerStores.
**Where:** dashboard/src/api/types.ts, endpoints/support.ts, hooks/useSupportSocket.ts
**Depends:** T1.1, T2.1, T2.2
**Done when:** types compile, socket handles new event, api methods exist
**Gate:** `pnpm typecheck`

---

### T3.2: ExchangeCard + ImageGallery + Lightbox
**What:** render return_request metadata as a formatted card (reason badge, item list w/ thumbnails, evidence gallery). Lightbox with keyboard nav, alt text, lazy load. Theme-aware, responsive.
**Where:** dashboard/src/pages/support-settings/components/ExchangeCard.tsx, ImageGallery.tsx, Lightbox.tsx
**Depends:** T3.1
**Done when:** card renders all fields; gallery opens lightbox; a11y (alt, kbd)
**Gate:** `pnpm typecheck` + `pnpm build` + visual check

---

### T3.3: SupportChatDrawer metadata switch + PartnerStoreDropdown
**What:**
- SupportChatDrawer: switch on metadata.kind → ExchangeCard / transferred banner / text
- PartnerStoreDropdown: searchable dropdown, shows only if marketplace-origin; on select+confirm → transferTicket
**Where:** SupportChatDrawer.tsx, PartnerStoreDropdown.tsx
**Depends:** T3.2
**Done when:** exchange renders formatted; dropdown appears only for marketplace tickets; transfer works end-to-end
**Gate:** `pnpm typecheck` + `pnpm build`

---

## Phase 4: Storefront/Widget — buyer image upload

### T4.1: Return form image upload UI
**What:** buyer return/exchange form: multi-image picker → uploadReturnImage → collect urls → submit with return.
**Where:** storefront return form component + api client (identify exact file during exec)
**Depends:** T1.3
**Done when:** buyer attaches images; they persist on the Return; appear in agent card
**Gate:** `pnpm typecheck` + `pnpm build` (storefront)

---

## Phase 5: Validation

### T5.1: Integration + audit
**What:** full flow test; verify tenant boundary; verify backward compat (old text messages).
**Depends:** T3.3, T4.1
**Gate:** api test+typecheck, dashboard typecheck+build, storefront typecheck+build; grep no cross-merchant leak

---

## Dependencies (DAG)

```
T0.1
 ├→ T1.1 ─┬→ T1.2
 │        └→ T2.2 ─→ T2.3
 ├→ T1.3 ──────────────────→ T4.1
 └→ T2.1 ─┐
          ├→ T3.1 → T3.2 → T3.3
 T2.2 ────┘
                              ↓
                            T5.1
```

**Critical path:** T0.1 → T1.1 → T2.2 → T3.1 → T3.2 → T3.3 → T5.1
**Parallel:** T1.2 ∥ T1.3 ∥ T2.1 (after T0.1/T1.1). T4.1 after T1.3.

## Effort
| Task | Est |
|------|-----|
| T0.1 | 45m |
| T1.1 | 45m |
| T1.2 | 1.5h |
| T1.3 | 1h |
| T2.1 | 45m |
| T2.2 | 1.5h |
| T2.3 | 1h |
| T3.1 | 45m |
| T3.2 | 2h |
| T3.3 | 1.5h |
| T4.1 | 1.5h |
| T5.1 | 1h |
| **TOTAL** | **~14h** |

**Status:** Ready for execution
