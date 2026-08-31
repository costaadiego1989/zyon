# Support Exchange/Return UI + Marketplace Handoff

**Status:** Specify
**Complexity:** Large (multi-app: api + dashboard + storefront/widget)
**Date:** 2026-08-30

## Problem

Two issues reported in the support hub for troca/devolução (exchange/return):

1. **Broken message content** — when a buyer opens an exchange/return, the message that reaches the agent (dashboard) is unformatted plain text. Reason (from audit): `SupportTicketMessage.content` is a raw `String` with no structure. Return data (`reason`, `items`, `imageUrls[]`) exists in the `Return` model but is NOT linked to the ticket, so the agent sees a concatenated blob with no images.

2. **No marketplace handoff** — when a return is for a marketplace product (sold by a partner store), the agent has no way to forward the ticket to the partner store. There is no UI to select a partner store and transfer ownership.

## Current State (audit evidence)

| Fact | Location |
|------|----------|
| `SupportTicketMessage.content` = plain String, no attachments/metadata | schema.prisma:377-390 |
| `SupportTicket` has no `returnId` link, no transferable ownership history | schema.prisma:359-375 |
| `Return` has `imageUrls[] String[]`, `reason ReturnReason`, `items ReturnItem[]` | schema.prisma:1428-1451 |
| Return NOT linked to SupportTicket (no cross-ref) | audit finding B |
| `S3UploadService` exists (upload, uploadBase64, delete) | apps/api/src/shared/storage/s3-upload.service.ts |
| `MarketplaceConnection` (buyerMerchantId ↔ sellerMerchantId) | schema.prisma:1803 |
| `FederatedProduct` (partner products, imageUrl) | schema.prisma:1815 |
| `CrossStoreLineItem` (marks marketplace-origin order lines) | schema.prisma:1836 |
| Dashboard chat renders `content` raw, no image/format | SupportChatDrawer.tsx |
| Support WS gateway `/support`: new_ticket, new_message, join_ticket | support.gateway.ts |

## Decisions (captured)

- **Images:** buyer uploads new evidence images on the exchange (not just catalog URLs). Reuse existing `S3UploadService`.
- **Partner dropdown eligibility:** show only when the ticket/return is marketplace-origin (item is a `CrossStoreLineItem`).
- **Handoff behavior:** transfer ticket ownership to partner store (`merchantId` change) + notify new owner via WS. Keep an audit trail of the transfer.

## Requirements

### R1: Structured exchange message (fix broken content)
- Add structured metadata to support messages so exchange/return context renders properly.
- `SupportTicketMessage` gains a `metadata` JSON column (nullable): `{ kind: "return_request", returnId, reason, items[], imageUrls[] }`.
- When a return is created, link it to a support ticket (`Return.ticketId` or `SupportTicket.returnId`) and emit a structured message.
- Backward compatible: existing text messages keep working (metadata null → plain render).

### R2: Image display + upload in chat
- Buyer (storefront/widget) can attach 1..N images when opening exchange → uploaded via existing S3 service → stored in `Return.imageUrls[]` and referenced in message metadata.
- Dashboard chat renders images inline (thumbnail grid, click → lightbox).
- Formatted exchange card in agent chat: reason badge, item list, image gallery — not a raw string.

### R3: Marketplace partner handoff
- Dashboard support chat: if ticket is marketplace-origin, show "Vincular loja parceira" button.
- Button opens a **search dropdown** of connected partner stores (`MarketplaceConnection` where buyerMerchantId = current merchant, status active). Searchable by store name.
- Selecting a store + confirm → transfers ticket ownership to `sellerMerchantId`, emits WS `ticket_transferred`, writes audit trail.
- New owner sees ticket in their support inbox; original merchant sees "transferred to X" status.

### R4: Formatting polish
- Exchange message card styled consistently (light/dark), responsive, accessible.
- Image gallery: lazy load, alt text, keyboard nav in lightbox.

## Acceptance Criteria

- ✅ Return creation links to a SupportTicket and emits a structured message (metadata populated)
- ✅ Agent dashboard renders exchange as a formatted card (reason, items, images) — no raw blob
- ✅ Buyer can attach images; they appear in the agent chat
- ✅ Marketplace-origin tickets show partner-store dropdown; non-marketplace do not
- ✅ Selecting partner store transfers ticket + notifies + audit trail
- ✅ Backward compatible: old text messages still render
- ✅ typecheck + tests pass (api + dashboard)
- ✅ merchant_id tenant boundary respected on all new queries

## Out of Scope

- Buyer-side return status tracking UI redesign (separate feature)
- Automated refund on partner acceptance (settlement flow already exists)
- Multi-image editing/cropping

## Risks

- **Tenant boundary on transfer:** transferring `merchantId` must preserve buyer scoping and not leak data across merchants. Audit trail mandatory.
- **Migration:** adding `metadata` + `returnId` columns needs a prisma migration (additive, nullable — safe).
- **WS event contract:** new `ticket_transferred` event must not break existing dashboard socket handlers.

## Deliverables

1. spec.md (this)
2. design.md — schema changes, message metadata contract, transfer flow, UI components
3. tasks.md — atomic tasks + dependencies
4. Implementation: prisma migration, api use-cases, dashboard UI, storefront/widget upload
5. Tests + verification
