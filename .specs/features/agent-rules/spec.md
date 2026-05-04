# Agent Rules Module Spec

## Goal

Create the `agent-rules` bounded context so merchants and merchant users can define how their checkout agents behave, what each agent is called, what each agent may say, and what constraints each agent must follow while negotiating.

`agent-rules` provides negotiation context to the conversation and checkout flows. It also prepares the platform for future machine-to-machine negotiation by making agent capabilities explicit per merchant and per user-owned agent. It does not authorize discounts, shipping subsidies, stock, delivery dates, or payment status. Deterministic decision/shipping/merchant rules still decide commercial permissions.

## Ownership

The `agent-rules` module owns:

- Agent identity per merchant/user: display name, persona, tone, language, and greeting style.
- Agent ownership: merchant-level default agents and user-specific agents.
- Agent capabilities/superpowers: named skills the agent may use, for example price objection handling, shipping objection handling, trust reassurance, payment friction guidance, escalation, and machine negotiation readiness.
- Guardrails: prohibited claims, required disclaimers, escalation rules, sensitive topics, and forbidden negotiation patterns.
- Negotiation behavior configuration: allowed objection-handling playbooks, fallback copy, urgency/cooldown language, and human-handoff hints.
- Checkout settings used as context: checkout mode, intervention timing preferences, widget opening behavior, maximum chat aggressiveness, and copy constraints.
- Agent context snapshots consumed by conversation/checkout use cases.

The module does not own:

- Merchant commercial limits.
- Discount authorization.
- Shipping subsidy authorization.
- LLM provider integration.
- Checkout session state.
- Analytics projections.

## Requirements

- AR-REQ-001: Authenticated merchant users can read their merchant default agent rules and their own user-specific agent rules.
- AR-REQ-002: Authenticated merchant users can update agent name, tone, language, persona, greeting, and capabilities.
- AR-REQ-003: Authenticated merchants can define guardrails as structured rules, not free-form-only text.
- AR-REQ-004: Guardrails must include blocked claims for discount, free shipping, delivery promise, stock promise, payment status, legal/medical/financial promises, and abusive pressure.
- AR-REQ-005: Checkout settings must include agent mode, trigger preferences, cooldown seconds, max interventions per session, and widget opening preference.
- AR-REQ-006: Agent context query must merge agent identity, capabilities, guardrails, checkout settings, and merchant-facing copy constraints into a DTO safe for conversation use cases.
- AR-REQ-007: Agent context must be scoped by authenticated `merchant_id` and optionally by authenticated `user_id`.
- AR-REQ-008: Defaults must be safe: consultative tone, no invented offers, no hard pressure, no delivery promises without source, and escalation when uncertain.
- AR-REQ-009: Prisma persistence must store agent rules by `merchant_id`, optional `user_id`, and `agent_id`, and keep an audit timestamp.
- AR-REQ-010: Each merchant must have one default agent rule set and may have multiple user-specific agents.
- AR-REQ-011: Future machine-to-machine negotiation metadata must be represented as configuration, not code paths, in this first version.
- AR-REQ-012: Tests must cover domain defaults, validation, protected use cases, Prisma repository, and protected e2e routes.

## API Surface

- `GET /agent-rules`
- `PUT /agent-rules`
- `GET /agent-rules/:agentId`
- `PUT /agent-rules/:agentId`
- `GET /agent-rules/:agentId/context`
- `GET /agent-rules/context` for the merchant/user default context.

All routes require JWT authentication through the auth cookie or bearer token.

## Acceptance Criteria

- A new merchant has safe default agent rules.
- A user can customize their own agent without changing the merchant default agent.
- Updating agent settings never changes merchant commercial policy.
- Conversation-facing context contains no secrets and no Prisma-specific fields.
- Protected routes reject unauthenticated requests.
- `pnpm test`, `pnpm test:prisma`, and `pnpm typecheck` pass after implementation.
