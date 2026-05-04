# Modular DDD Foundation Spec

## Goal

Prepare the AI Checkout Sales Agent codebase for modular development with clear bounded contexts, Prisma/PostgreSQL persistence, CQRS, RabbitMQ eventing through an outbox, and TDD-oriented implementation tasks.

This feature is documentation-first. It defines the development base for future implementation without changing runtime behavior yet.

## Requirements

- MDF-REQ-001: Each business module must document its ownership, responsibilities, public commands, public queries, emitted events, consumed events, ports, invariants, and required tests.
- MDF-REQ-002: Module ownership must make clear who owns each rule and which module is only a consumer of facts.
- MDF-REQ-003: Cross-module communication must avoid strong coupling. Modules may call local application ports for synchronous reads/use cases inside the monolith, but asynchronous side effects must use domain events through outbox and RabbitMQ.
- MDF-REQ-004: RabbitMQ events must represent facts that already happened, not commands waiting for another module to answer synchronously.
- MDF-REQ-005: RabbitMQ must use reusable durable topology: `aacp.events`, `aacp.retry`, `aacp.dlx`, topic routes, responsibility-based queues, retry, dead-lettering, and idempotent consumers.
- MDF-REQ-006: Prisma/PostgreSQL must be the target persistence layer, replacing in-memory repositories through the same domain/application ports.
- MDF-REQ-007: Prisma models must support checkout sessions, checkout events, offers, conversations, merchant rules, integrations, outbox messages, and analytics read models.
- MDF-REQ-008: Every command and query must be scoped by `merchant_id`; `global_user_id` must never allow cross-merchant data mixing.
- MDF-REQ-009: CQRS must separate state-changing commands from read-optimized queries. Commands own writes and outbox messages; queries own read models and projections.
- MDF-REQ-010: The LLM must remain non-authoritative. It can classify, summarize, and phrase responses, but deterministic modules authorize discounts, shipping subsidies, payment claims, stock, and delivery claims.
- MDF-REQ-011: Tests must be planned before implementation for domain rules, application use cases, Prisma repositories, event contracts, RabbitMQ workers, and e2e flows.
- MDF-REQ-012: Existing MVP behavior must remain the compatibility baseline: start checkout, track events, decide intervention, chat, evaluate shipping, apply offer, and dashboard overview.

## Module Requirements

### Checkout

- Owns checkout sessions, checkout lifecycle events, abandonment state on the session, accepted offers attached to the session, and order completion facts.
- Emits checkout/session/order facts for analytics, recovery, conversation, and commerce consumers.
- Does not own commercial policy, shipping policy, LLM messaging, or external commerce implementation.

### Merchant

- Owns merchant configuration, commercial rules, shipping rules, brand voice, integration credentials metadata, feature flags, and policy limits.
- Provides rules to decision, shipping, conversation, and commerce use cases through ports.
- Emits configuration facts when rules or integrations change.

### Decision

- Owns intervention decision, abandonment scoring policy, deterministic offer orchestration, and commercial safety gates.
- Coordinates rules from merchant, margin/rules engines, and shipping evaluation.
- Emits authorization facts, but does not apply offers in external commerce platforms.

### Shipping

- Owns shipping offer evaluation, shipping subsidy calculations, blocked region handling, and margin checks related to freight.
- Consumes checkout context and merchant shipping rules.
- Emits shipping decision facts. It does not quote carriers in the MVP.

### Conversation

- Owns objection classification, safe message generation, LLM adapter orchestration, and fallback messages.
- May mention only authorized offers received from deterministic modules.
- Never authorizes offers, stock, delivery dates, or payment status.

### Commerce

- Owns external commerce adapters and offer application in Shopify first, then WooCommerce/custom APIs.
- Consumes authorized/applied-offer requests from application use cases or events.
- Emits commerce application facts, success, failure, and fallback reasons.

### Payment

- Owns payment-related facts captured from checkout or platform adapters, including failure reason, selected method, and rescue opportunity.
- MVP records payment events only. Payment processing remains external.
- Future work may emit payment rescue facts for conversation and recovery.

### Analytics

- Owns read models, dashboard projections, attribution windows, conversion metrics, margin metrics, and revenue incremental views.
- Consumes facts from checkout, offer, order, payment, and recovery.
- Must be query-only from presentation/dashboard flows.

### Recovery

- Owns post-abandonment recovery intent and delivery through approved channels.
- Planned after MVP. It consumes abandonment and authorized recovery facts.
- Must enforce consent, expiration, attribution, and anti-spam policies.

## Acceptance Criteria

- `.specs/features/modular-ddd-foundation/spec.md`, `design.md`, and `tasks.md` exist and follow the spec-driven workflow.
- The design lists module ownership, boundaries, CQRS conventions, Prisma targets, RabbitMQ topology, event contracts, and outbox flow.
- The tasks file contains atomic implementation tasks with dependencies, verification criteria, and tests.
- Roadmap and state documents record the new architectural decisions and next milestone.
- No runtime source code is changed as part of this documentation feature.
