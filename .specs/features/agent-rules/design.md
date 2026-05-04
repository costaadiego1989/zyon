# Agent Rules Module Design

## Clean Architecture Layout

```text
apps/api/src/modules/agent-rules/
  domain/
    entities/
      agent-rules.entity.ts
    value-objects/
      agent-tone.vo.ts
      guardrail.vo.ts
    ports/
      agent-rules-repository.port.ts
  application/
    use-cases/
      get-agent-rules.use-case.ts
      update-agent-rules.use-case.ts
      get-agent-context.use-case.ts
  infrastructure/
    repositories/
      in-memory-agent-rules.repository.ts
    prisma/
      prisma-agent-rules.repository.ts
  presentation/
    http/
      agent-rules.controller.ts
  agent-rules.module.ts
```

## Domain Shape

### Agent Identity

- `agentName`
- `persona`
- `tone`: `consultative | premium | direct | friendly | technical`
- `language`: initial default `pt-BR`
- `greeting`

### Guardrails

Structured booleans/lists:

- `forbidUnauthorizedDiscounts`
- `forbidUnauthorizedFreeShipping`
- `forbidDeliveryPromisesWithoutSource`
- `forbidStockPromisesWithoutSource`
- `forbidPaymentStatusClaims`
- `forbidLegalMedicalFinancialAdvice`
- `forbidAbusivePressure`
- `blockedPhrases`
- `requiredDisclaimers`
- `escalationTriggers`

### Checkout Settings

- `agentMode`: `silent_until_trigger | proactive | manual_only`
- `openWidgetOnTrigger`
- `cooldownSeconds`
- `maxInterventionsPerSession`
- `triggerPreferences`
- `handoffEnabled`

## Agent Context DTO

`GetAgentContextUseCase` returns a flattened safe DTO:

```json
{
  "merchant_id": "mrc_...",
  "agent": {
    "name": "Clara",
    "tone": "consultative",
    "language": "pt-BR",
    "persona": "checkout sales assistant"
  },
  "guardrails": {
    "forbid_unauthorized_discounts": true,
    "forbid_delivery_promises_without_source": true
  },
  "checkout_settings": {
    "agent_mode": "silent_until_trigger",
    "open_widget_on_trigger": true,
    "cooldown_seconds": 120,
    "max_interventions_per_session": 3
  },
  "copy_constraints": [
    "Mention offers only when authorized by deterministic modules.",
    "Use estimated delivery wording only when a source exists."
  ]
}
```

## Integration Points

- `conversation` consumes agent context when generating safe copy.
- `checkout` may consume checkout settings to decide widget opening behavior, but checkout does not own the rules.
- `decision` and `shipping` remain commercial authorities.
- `merchant` remains owner of commercial/shipping policy; `agent-rules` owns behavior/copy constraints only.

## Persistence

Prisma model target:

  - `AgentRule`
  - `agent_id`
  - `merchant_id`
  - optional `user_id`
  - `scope`: `merchant_default | user_agent`
  - identity JSON fields or typed columns
  - capabilities JSON
  - guardrails JSON
  - checkout settings JSON
  - `created_at`
  - `updated_at`

Keep all reads and writes scoped by `merchant_id`. User-specific reads must also match authenticated `user_id`, except merchant owners/admins may read merchant default rules.

## Testing

- Domain tests for defaults and validation.
- Use case tests with fake repository.
- Guard/protected route tests.
- Prisma integration tests for tenant isolation and update/read roundtrip.
- E2E protected route test: register merchant -> update agent rules -> read context.
