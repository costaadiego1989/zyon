# Checkout Settings Module Design

## Ownership

`checkout-settings` owns operational checkout behavior. It answers questions such as:

- Should the agent be silent, proactive, or manual?
- Which checkout events may trigger the widget?
- How often can the agent intervene in a session?
- When should the widget stay suppressed?
- Is human handoff available?

It does not answer whether a buyer can receive a discount, shipping subsidy, delivery promise, or any margin-sensitive concession.

## Module Layout

```text
apps/api/src/modules/checkout-settings/
  domain/
    entities/
      checkout-settings.entity.ts
    ports/
      checkout-settings-repository.port.ts
  application/
    use-cases/
      get-checkout-settings.use-case.ts
      update-checkout-settings.use-case.ts
      reset-checkout-settings.use-case.ts
      get-checkout-settings-context.use-case.ts
  infrastructure/
    in-memory-checkout-settings.repository.ts
    prisma-checkout-settings.repository.ts
  presentation/
    http/
      checkout-settings.controller.ts
  checkout-settings.module.ts
```

## Aggregate

`CheckoutSettings`:

- `merchantId`
- `mode`
- `widgetBehavior`
- `interventionPolicy`
- `triggerRules`
- `suppressionRules`
- `handoff`
- `createdAt`
- `updatedAt`

The aggregate validates cooldown minimums, intervention limits, known trigger names, and the absence of commercial authorization fields.

## Context DTO

```json
{
  "merchant_id": "mrc_...",
  "checkout_settings": {
    "mode": "silent_until_trigger",
    "open_widget_on_trigger": true,
    "cooldown_seconds": 120,
    "max_interventions_per_session": 3,
    "enabled_triggers": ["shipping_objection_detected", "coupon_field_clicked", "idle_30_seconds"],
    "handoff_enabled": true
  },
  "operational_constraints": [
    "Do not open the widget more than the configured max interventions per session.",
    "Do not mention offers unless authorized by deterministic modules."
  ]
}
```

## API

All routes are protected by JWT and derive `merchant_id` from the authenticated principal:

- `GET /checkout-settings`
- `PUT /checkout-settings`
- `POST /checkout-settings/reset`
- `GET /checkout-settings/context`

## Prisma

```prisma
model CheckoutSetting {
  id                 String   @id @default(cuid())
  merchantId         String   @unique @map("merchant_id")
  mode               String
  widgetBehavior     Json     @map("widget_behavior")
  interventionPolicy Json     @map("intervention_policy")
  triggerRules       Json     @map("trigger_rules")
  suppressionRules   Json     @map("suppression_rules")
  handoff            Json
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  @@index([merchantId])
  @@map("checkout_settings")
}
```

JSON columns are acceptable in the first version because these settings are policy-shaped configuration and still evolving. Domain validation owns their shape before persistence.

## Integration

- `agent-rules` composes identity, capabilities, and guardrails with the checkout-settings context.
- `checkout` uses checkout-settings to decide trigger/open behavior.
- `conversation` receives the already-composed safe context through ports.
- `agent-rules.checkoutSettings` is kept only as a compatibility bridge until migrated.
