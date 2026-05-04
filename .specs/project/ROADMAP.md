# Roadmap

**Current Milestone:** Functional AACP Checkout MVP
**Status:** In Progress

---

## Functional AACP Checkout MVP

**Goal:** A merchant can configure rules, embed a secure checkout widget, negotiate with a buyer, charge the buyer through Asaas, sync the order to commerce, and see analytics.
**Target:** Shippable local/pilot MVP.

### Features

**Checkout Session Identity** - IN PROGRESS

- Create `session_id` and `global_user_id`.
- Link external customer identifiers to the global buyer identity.
- Keep all history scoped by `merchant_id`.
- Close the checkout bounded context with TDD tasks documented in `.specs/features/checkout-module/`.
- Cover checkout domain, use cases, repository ports, event contracts, outbox-ready flow, and compatibility e2e tests before moving to the next module.

**Decision and Offer Engine** - IN PROGRESS

- Score abandonment from checkout events.
- Trigger the agent only on meaningful hesitation.
- Authorize discounts and shipping offers using margin rules.

**Conversational Widget** - IN PROGRESS

- Embed as Web Component.
- Capture checkout signals.
- Chat with the buyer and show offer actions.
- Move to a token-only secure embed that does not receive sensitive cart, margin, cost, or customer data.

**Payment Asaas** - PLANNED

- Create payment intents for checkout sessions.
- Charge buyers through Asaas without storing raw card data or CVV.
- Confirm or fail checkout through idempotent Asaas webhooks.

**Commerce Sync** - PLANNED

- Validate cart server-side through commerce adapters.
- Create pending orders in Shopify/WooCommerce/etc.
- Mark commerce orders as paid only after payment approval.

**Billing Asaas** - PLANNED

- Charge merchants for SaaS usage separately from buyer payments.
- Consume metering events and enforce plan quotas.

**Merchant Dashboard** - IN PROGRESS

- Configure commercial and shipping rules.
- Show conversations, offers, and conversion metrics.

---

## Post-MVP Hardening

**Goal:** Move from dev MVP to merchant pilot.

### Features

**Modular DDD Foundation** - PLANNED

- Document module ownership for checkout, merchant, decision, shipping, conversation, commerce, payment, analytics, and recovery.
- Prepare Prisma/PostgreSQL persistence, CQRS, RabbitMQ outbox, event contracts, and TDD tasks.
- Feature spec: `.specs/features/modular-ddd-foundation/`.

**PostgreSQL Persistence with Prisma** - PLANNED

- Replace in-memory repositories behind existing ports.
- Persist sessions, events, offers, rules, conversations, integrations, outbox, and read models.
- Keep all commands and queries scoped by `merchant_id`.

**RabbitMQ Outbox Eventing** - PLANNED

- Publish domain facts through durable outbox workers.
- Use `aacp.events`, `aacp.retry`, and `aacp.dlx` topology.
- Keep consumers idempotent and responsibility-scoped.

**Shopify OAuth App Install** - PLANNED
**A/B Holdout Analytics** - PLANNED
**Payment Failure Rescue** - PLANNED

---

## Future Considerations

- WhatsApp/email recovery.
- ML-based abandonment scoring.
- Multi-platform adapters.
- Advanced shipping and warehouse optimization.
