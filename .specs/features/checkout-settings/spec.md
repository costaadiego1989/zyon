# Checkout Settings Module Spec

## Goal

Create the `checkout-settings` bounded context as the source of truth for operational checkout configuration that controls when and how the agent appears during checkout.

This module provides safe context to `agent-rules`, `checkout`, and `conversation`, but never authorizes discounts, free shipping, margin decisions, stock, delivery promises, or payment status.

## Scope

### In Scope

- Per-merchant checkout agent mode: `silent_until_trigger`, `proactive`, or `manual_only`.
- Widget behavior: auto-open on trigger, minimized default, placement, and initial delay.
- Intervention policy: enabled triggers, minimum abandonment score, cooldown, and maximum interventions per session.
- Suppression rules: steps, regions, low cart values, buyer opt-out, and post-offer suppression.
- Handoff settings: enabled flag, message, and allowed channels.
- Safe context DTO for composition into `agent-rules` and `conversation`.
- Defaults for new merchants.
- Prisma persistence by `merchant_id`.
- Protected HTTP API for merchant owners.

### Out Of Scope

- Discount, free shipping, margin, offer expiration, and commercial authorization policy.
- Agent name, persona, tone, linguistic guardrails, and superpowers.
- Checkout session state and lifecycle events.
- LLM provider orchestration.
- Analytics projections.

## Requirements

- CS-REQ-001: Every command and query must be scoped by `merchant_id`.
- CS-REQ-002: Missing settings must resolve to safe merchant defaults.
- CS-REQ-003: Settings must not authorize commercial offers or override deterministic engines.
- CS-REQ-004: Intervention policy must prevent excessive pressure through cooldown and per-session limits.
- CS-REQ-005: Context returned to other modules must contain no secrets, Prisma rows, or internal persistence fields.
- CS-REQ-006: `agent-rules.checkoutSettings` remains a compatibility field until composition is migrated.
- CS-REQ-007: Prisma persistence must include `merchant_id`, timestamps, and tenant-safe indexes.
- CS-REQ-008: Tests must cover domain validation, use cases, Prisma persistence, protected HTTP routes, and context composition.

## Acceptance Criteria

- `checkout-settings` is documented with spec, design, and task closure criteria.
- A TDD matrix maps each requirement to domain, application, repository, integration, and e2e tests.
- `agent-rules` can compose a safe checkout-settings snapshot without owning the operational settings.
- `checkout` can query settings for trigger/open behavior without importing persistence details.
- The module closes only when `pnpm test`, `pnpm test:prisma`, and `pnpm typecheck` pass.
