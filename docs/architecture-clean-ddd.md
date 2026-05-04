# Clean Architecture + Modular DDD

This project must be implemented as a modular monolith following Clean Architecture and tactical DDD. The rule is simple: business policy points inward, frameworks and vendors point outward.

## Architecture Rings

```text
presentation -> application -> domain <- infrastructure
```

- `domain`: entities, value objects, domain services, domain events, and repository ports. No NestJS, HTTP, database, Shopify, OpenAI, or environment variables.
- `application`: use cases and orchestration. It coordinates domain behavior through ports and returns DTO-compatible results.
- `infrastructure`: adapters for persistence, Shopify, OpenAI, PostgreSQL, Redis, and other external systems.
- `presentation`: HTTP controllers, request/response transport, validation, and framework concerns.

Dependencies may only point inward. `domain` imports nothing from the app. `application` imports `domain`. `infrastructure` implements `domain/application` ports. `presentation` calls application use cases.

## Bounded Contexts

- `checkout`: sessions, events, identity, abandonment score, conversation, offers, dashboard read model.
- `merchant`: merchant configuration, rules, brand voice, integrations. In the MVP this lives inside the checkout module but must stay separable.
- `commerce`: external commerce adapters, starting with Shopify.
- `analytics`: conversion, offer acceptance, margin and revenue attribution. In the MVP it is a read model over checkout events.

## Required Module Layout

```text
apps/api/src/modules/[context]/
  domain/
    entities/
    ports/
    services/
  application/
    use-cases/
  infrastructure/
    repositories/
    adapters/
  presentation/
    http/
  [context].module.ts
```

Packages under `packages/*` are pure or adapter libraries. They must not import NestJS.

## DDD Rules

- `merchant_id` is the tenant boundary for all queries and commands.
- `global_user_id` is the platform buyer identity, but buyer history is always filtered by `merchant_id`.
- The LLM is not a domain authority. It may classify and phrase a response, but only rules engines authorize offers.
- Discounts, shipping subsidies, delivery claims, and margin decisions must be deterministic and auditable.
- Use cases are named as verbs, for example `StartCheckoutUseCase`, `TrackCheckoutEventUseCase`, `ApplyOfferUseCase`.
- Repositories expose intention-revealing methods, not generic ORM leakage.

## Spec-Driven Workflow

The project follows `.cursor/skills/tlc-spec-driven/SKILL.md`:

1. Specify requirements in `.specs/features/[feature]/spec.md`.
2. Add architecture in `design.md` for large or cross-context changes.
3. Add atomic tasks in `tasks.md` before implementation.
4. Execute, verify, and update `.specs/project/STATE.md`.

No feature should bypass specs when it changes public APIs, domain rules, persistence, integrations, or user-facing behavior.
