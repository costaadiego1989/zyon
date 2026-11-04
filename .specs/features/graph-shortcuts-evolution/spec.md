# Graph search and buyer shortcuts

**Approved**: 2026-11-04 - user: "agora siga com evolução do cyper e atalhos". This resumes the approved roadmap. Production releases and automated Athom buyer testing were explicitly authorized earlier.

## Problem Statement

Catalog searches cannot represent OR alternatives or strict rating boundaries, and /atalhos exposes only generic shopping replies rather than the buyer hub. Buyers need executable commands and exact current catalog evidence.

## Scope

Implement bounded Boolean catalog criteria, strict commercial boundaries, and the first usable buyer shortcut hub. Preserve the existing signed private Community query gateway, tenant checks and canonical rereads. Saved addresses are the same global buyer address records used by the storefront, as requested by hub parity. Display this scope before edits.

## Out of Scope

This increment does not activate every roadmap phase. Per-candidate freight quotes, embeddings of review comments, agent tasks, security/export/delete flows and voice remain separate roadmap deliveries. No payment, purchase, shipment or deletion of the buyer account is required for acceptance.

## Assumptions & Open Questions

Open questions: none for this increment; shared address behavior follows the requested storefront hub parity.

- Approval continues the concrete roadmap rather than requesting another planning approval.
- Alternatives are bounded groups of OR attribute predicates, combined with AND groups and mandatory exclusions, on one canonical variant. Unknown attributes never prove a negative fact.
- Old version-1 plans retain inclusive boundaries. Explicit greater/less-than operators use separate flags, never silent rounding of ratings.
- Registered identity uses the authenticated leased Meta sender. Ambiguous accounts reveal no saved data. Phone-only accounts may use only their verified channel-owned canonical account.
- Address mutations are transactional, scoped to the resolved buyer, idempotent through deterministic action identity and persisted state, and explicitly confirmed for deletion. Changes affect the shared buyer profile, never an already-created order or pending payment.

## User Stories

### P1: Find products with precise criteria

**User Story**: Como comprador, quero combinar alternativas, exclusões e limites sem receber produtos incompatíveis.

**Independent Test**: Consultar produtos com cor azul ou verde, sem couro, até R$100 e avaliação acima de 4; conferir IDs, valores e atributos atuais.

**Acceptance Criteria**:

- GRAPH-01: WHEN a plan contains required attributes and alternative groups, the system SHALL require every mandatory predicate and one predicate per alternative group on the same variant in parameterized SQL, Cypher and output projection, rejecting unknown negative facts and never accepting query syntax from the buyer.
- GRAPH-02: WHEN the buyer requests above/below a price or rating boundary, the system SHALL enforce strict comparisons in canonical reads and pricing, keep legacy boundaries inclusive, and describe the actual operator in the evidence returned to both channels.
- GRAPH-03: WHEN a structured planner emits alternatives or boundaries, the system SHALL preserve them through immutable planning, semantic candidate selection and canonical rereads; conflicting or unbounded plans SHALL be rejected without a relaxed retry.

### P2: Manage my buyer hub from WhatsApp

**User Story**: Como comprador, quero atalhos funcionais para meu cadastro e meus endereços e para continuar a compra.

**Independent Test**: Abrir /atalhos, /dados e /enderecos; adicionar, editar, definir padrão e excluir um endereço de teste; cancelar uma coleta; abrir compra rápida e carrinho sem gerar cobrança.

**Acceptance Criteria**:

- HUB-01: WHEN /atalhos is requested, the system SHALL advertise only implemented registered commands, map native choices and typed commands to the same handlers, preserve cart/payment state, and route shopping/checkout commands through existing authorized operations.
- HUB-02: WHEN a protected shortcut runs, the system SHALL derive the buyer from the current authenticated leased sender and merchant/conversation, reject missing or ambiguous identity without revealing saved data, and never trust a buyer ID supplied in text or an action.
- HUB-03: WHEN the buyer manages saved addresses, the system SHALL support list/add/edit/default/delete with bounded validated fields, cancellation and expiry, shared storefront persistence, owner-scoped transactional mutations and duplicate-action protection; deletion SHALL require explicit confirmation and stale actions SHALL not alter current records or pending orders/payments.

## Requirement Traceability

| Requirement ID | Story | Task | Status |
| --- | --- | --- | --- |
| GRAPH-01 | P1 | T1 | Pending |
| GRAPH-02 | P1 | T1/T2 | Pending |
| GRAPH-03 | P1 | T2 | Pending |
| HUB-01 | P2 | T3 | Pending |
| HUB-02 | P2 | T3 | Pending |
| HUB-03 | P2 | T4 | Pending |

## Checks

**C1** - GRAPH-01 predicates and parameterized query compilation
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/catalog/domain/services/catalog-search-criteria.spec.ts ./apps/api/src/modules/catalog/infrastructure/repositories/catalog-search-criteria.spec.ts ./apps/api/src/modules/graph-rag/domain/graph-query.spec.ts`

**C2** - GRAPH-02/GRAPH-03 planner, price/rating boundaries and preserved evidence
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/storefront/infrastructure/tool-handlers/advanced-shopping-criteria.spec.ts ./apps/api/src/modules/storefront/infrastructure/ai/structured-shopping-planner.spec.ts ./apps/api/src/modules/catalog/infrastructure/graph-catalog-search.spec.ts`

**C3** - HUB-01/HUB-02 registered shortcuts and verified identity
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-buyer-hub.spec.ts`

**C4** - HUB-03 persisted address lifecycle and replay safeguards
Proof: `node --import ./apps/api/tests/test-network-guard.mjs --loader ./apps/api/tests/ready-prod-loader.mjs --test --test-force-exit ./apps/api/src/modules/whatsapp-channel/application/services/whatsapp-hub-addresses.spec.ts`

**Build**: `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false`
**Mutations**: 3

## Handoff

**Dispatched:** none.
