# WhatsApp product menus and animated status

**Approved**: 2026-11-04 - user: "pode remover voltar e veja pq o menu corta o nome dos produtos e corrija"; "confira tambem as mensagens de pagamento a ui"; "crie planejamento de tudo isso"; "quero ver se vc consegue transformar os videos de ui em gif".

This records existing implementation authority. Production authority was separately given: "so da para testar em produção mesmo pode subir prod e testar". No new approval is inferred from silence. Optional impeccable update was declined: "Continuar com a versão atual".

## Problem Statement

Correct the product menu shown in the user's bug screenshot. The image demonstrates the defect, not a target pixel layout: numbered names are cut mid-word and a redundant Voltar row appears. Preserve native WhatsApp dimensions, semantic selection IDs, other checkout navigation, cart consent and payment/stock truth. Generate GIF exports and send the same five existing animations through the supported animated-sticker transport. Audit payment presentation. Deliver a complete implementation plan for buyer hub shortcuts and advanced graph search; those future capabilities are not activated by this patch.

## Out of Scope

Implementing the full buyer hub, arbitrary Cypher generation, review embeddings, freight candidate quotation, new artwork, new charges and shipment transitions. These receive a concrete roadmap.

## Assumptions & Open Questions

- Voltar removal applies to catalog lists from the screenshot; checkout and detail back navigation remain useful.
- Native list titles have 24 characters and descriptions 72; full arbitrary product names cannot fit a fixed native field. Long titles use the product part after a brand separator when useful, then word-aware ellipsis. Full names and commercial descriptions remain available in accompanying text and product details.
- Existing MP4 artwork is retained. Five GIFs are exports; animated WebP stickers are used for Cloud API delivery. Client autoplay must be observed, never promised for every device/configuration.
- No purchase, payment approval, stock change or shipment is generated to preview status media.

## User Stories

### P1: Read products and recognize order status

**User Story**: Como comprador, quero nomes legíveis, animações imediatas e valores claros durante a compra.

**Independent Test**: Abrir a lista real, selecionar um produto e observar a saudação animada. Conferir os recibos existentes sem reenviar uma confirmação de pagamento.

**Acceptance Criteria**:

- MENU-01: WHEN a catalog list is displayed, the system SHALL omit its Voltar row, keep all products and pagination reachable, and keep native IDs and numeric fallback bound to the original actions.
- MENU-02: WHEN a product has a long name, the system SHALL display a readable unnumbered native title within 24 characters, preserve its full name and price in a description or accompanying text, and avoid silently cutting words. Navigation labels and full canonical product names SHALL remain unchanged.
- MOTION-01: WHEN a welcome, confirmed cart addition, empty cart, approved payment or shipped order is presented, the system SHALL use a 512x512 animated WebP sticker with multiple frames and size below 100000 bytes, and expose a genuine animated GIF export of the same artwork.
- MOTION-02: WHEN sticker media is sent, the system SHALL use a caption-free HTTPS sticker payload, retain image handling for ordinary product images, preserve greeting-before-animation ordering and suppress animation replays on navigation.
- MOTION-03: IF a cart mutation is unconfirmed, payment unapproved, shipment unshipped, sender/merchant scope wrong or delivery acceptance unknown, the system SHALL retain the existing no-success/no-replay guards and immutable delivery identity.
- PAYMENT-01: WHEN presenting a canonical approved itemized payment, the system SHALL disclose product subtotal, discount, freight, service fee and buyer total, retain pending-versus-approved distinction and raw Pix bytes, and direct buyers to conversation/store purchase access rather than a merchant dashboard.

## Execution

1. Fix native product row presentation and catalog back removal. Files: meta-ui-renderer.ts and its spec. Verify exact screenshot names, long/Unicode names, paging and action bindings; commit independently.
2. Convert the five existing assets, extend the closed asset routes and sticker transport, and update welcome/cart/paid/shipped senders. Files: commerce-animations.ts/spec, meta-ui.types.ts, meta-ui-renderer.ts/spec, meta-cloud-sender.adapter.ts/spec, checkout-whatsapp-conversation.adapter.ts, order-notification-whatsapp.adapter.ts/spec, whatsapp-presentation.controller.ts, animation asset exports/README, Dockerfile.api and focused asset/transport tests. Verify frames, dimensions, bytes, HTTPS payloads, current delivery guards and TypeScript; commit independently.
3. Audit payment fixtures and create the complete shortcuts/Cypher roadmap and evidence report. Make payment code edits only for a demonstrated defect; otherwise retain already-correct receipt behavior. Verify existing receipt/payment/state tests. Run final regression, independent verification, exact-source deployment and a real native menu/media walkthrough.

## Requirement Traceability

| Requirement ID | Story | Task | Status |
| --- | --- | --- | --- |
| MENU-01 | P1 | T1 | Pending |
| MENU-02 | P1 | T1 | Pending |
| MOTION-01 | P1 | T2 | Pending |
| MOTION-02 | P1 | T2 | Pending |
| MOTION-03 | P1 | T2 | Pending |
| PAYMENT-01 | P1 | T3 | Pending |

## Checks

**C1** - MENU-01/MENU-02 catalog identity and readable names
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/domain/ui/meta-ui-renderer.spec.ts`

**C2** - MOTION-01/MOTION-02 genuine exported media and supported outbound transport
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/domain/ui/commerce-animations.spec.ts ./apps/api/src/modules/whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.spec.ts ./apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-presentation.spec.ts`

**C3** - MOTION-03 canonical order scope and immutable acceptance
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/notifications/infrastructure/adapters/order-notification-whatsapp.adapter.spec.ts`

**C4** - PAYMENT-01 canonical money, receipt and Pix rendering
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/notifications/domain/paid-order-receipt.spec.ts ./apps/api/src/modules/notifications/infrastructure/templates/paid-order-receipt.template.spec.ts ./apps/api/src/modules/whatsapp-channel/domain/ui/meta-ui-renderer.spec.ts`

**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`
**Mutations**: 3

## Handoff

**Dispatched:** none.
**Walked:** pending.
