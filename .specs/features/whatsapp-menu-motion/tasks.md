# WhatsApp menu and motion tasks

**Approved**: 2026-11-04 - user: "pode remover voltar e veja pq o menu corta o nome dos produtos e corrija"; "confira tambem as mensagens de pagamento a ui"; "crie planejamento de tudo isso"; "quero ver se vc consegue transformar os videos de ui em gif".
**Status**: In Progress
**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`
**Mutations**: 3

## Execution Plan

T1 -> T2 -> T3. Three tasks fit one inline batch. Independent Verifier after proofs.

## Test Coverage Matrix

| Requirements | Proof | Layer |
| --- | --- | --- |
| MENU-01/MENU-02 | C1 | Renderer contract |
| MOTION-01/MOTION-02 | C2 | Real assets and sender payload |
| MOTION-03 | C3 | Canonical state and durable delivery |
| PAYMENT-01 | C4 | Receipt math and channel presentation |

## Task Breakdown

### T1: Readable native product rows
**What**: Unnumber product titles, preserve full names and prices and remove catalog Voltar.
**Where**: meta-ui-renderer.ts and spec
**Depends on**: None
**Requirement**: MENU-01, MENU-02
**Tests**: unit
**Gate**: quick
**Done when**:
- [x] C1 passes including screenshot products, pagination and action identity.

### T2: Animated media exports and sticker delivery
**What**: Convert existing artwork and wire supported sticker media across the five states.
**Where**: Exact files enumerated in spec Execution 2
**Depends on**: T1
**Requirement**: MOTION-01, MOTION-02, MOTION-03
**Tests**: unit and asset contract
**Gate**: quick
**Done when**:
- [x] C2/C3 pass with real multiframe assets and immutable delivery guards.

### T3: Buyer payment review and complete capability roadmap
**What**: Verify canonical receipt math and buyer actions; document hub parity and graph gaps.
**Where**: docs/plans/whatsapp-buyer-hub-and-graph-roadmap-2026-11-04.md and audit evidence
**Depends on**: T2
**Requirement**: PAYMENT-01
**Tests**: existing payment/receipt contracts and production TypeScript; full regression remains a release gate
**Gate**: build
**Done when**:
- [x] C4 and build pass; plan states present versus future capabilities and full acceptance matrix. 99 payment/presentation tests, 150 motion contracts and production TypeScript passed. Readonly live receipt/projection/inventory evidence saved in the audit directory. Full regression remains a release gate.

## Gate Check Commands

Quick: the selected proofs under Checks.
Build: C1-C4 and production TypeScript. Guarded full regression runs before release after final source changes.

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
