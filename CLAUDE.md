# CLAUDE.md

## Mode

Use this file as the main operating guide for Claude Code.

- Be concise, direct, and technical.
- Prefer action over explanation.
- Use Caveman style by default: dense, low-token, no filler.
- Expand only for architecture, security, migrations, production risk, or ambiguity.
- Never paste huge logs or full files unless requested.
- Use context-mode for large outputs, repo-wide analysis, logs, and multi-file inspection.
- Optimize for speed, correctness, low context usage, and clean architecture.

## Context Mode

Use context-mode when output may be large or repetitive.

Use it for:
- build logs
- test logs
- command output
- browser snapshots
- repo-wide search
- multi-file inspection
- generated payloads
- long JSON or traces

Useful commands:
- `/context-mode:ctx-doctor`
- `/context-mode:ctx-stats`

Rules:
- Search before opening many files.
- Summarize large outputs.
- Report only relevant evidence.
- Prefer targeted scripts over manual inspection.

## Caveman Style

Default output:
- no filler
- no long intros
- no generic advice
- clear bullets
- exact commands
- exact files changed
- exact verification

Use this format:

```txt
Done:
- ...

Changed:
- ...

Verified:
- command → result

Notes:
- ...
```

If blocked:

```txt
Blocked:
Reason:
Need:
Safe next step:
```

## Commands

```bash
pnpm install

cd apps/api && pnpm dev
cd apps/widget && pnpm dev
cd apps/dashboard && pnpm dev

cd apps/api && pnpm typecheck
cd apps/widget && pnpm typecheck

cd apps/api && pnpm build
cd apps/widget && pnpm build

cd apps/api && pnpm test
cd apps/api && pnpm test:prisma
cd apps/widget && pnpm test
cd apps/widget && pnpm test:coverage        # vitest --coverage (thresholds: 70%)
cd packages/<pkg> && pnpm test

# Playwright e2e
cd apps/widget && pnpm e2e                  # widget-mocked project (no real API)
cd apps/widget && pnpm e2e:realapi          # widget-realapi project (real NestJS API)
cd apps/widget && pnpm e2e -- --grep @regression   # regression suite only
cd apps/widget && pnpm e2e:realapi -- --grep @live  # nightly live specs only

cd apps/api && pnpm prisma:generate
cd apps/api && pnpm prisma:migrate:dev
cd apps/api && pnpm prisma:deploy
```

No root-level test command. Run tests per app/package.

## Environment

Create `apps/api/.env`. Never commit secrets.

```env
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_API_VERSION=

OPENAI_API_KEY=
OPENAI_MODEL=

DATABASE_URL=postgresql://...
```

Without Shopify/OpenAI credentials, deterministic fallbacks must keep MVP flows usable.

## Repo Layout

```txt
apps/
  api/
  widget/
  dashboard/
  fake-commerce-api/

packages/
  shared-types/
  rules-engine/
  decision-engine/
  conversation-engine/
  shipping-engine/
  negotiation-engine/
  commerce-adapters/
  agentic-checkout-js/
```

Packages must not import NestJS or framework code.

## Architecture

Use Clean Architecture + Modular DDD.

Dependency direction:

```txt
presentation → application → domain ← infrastructure
```

Module structure:

```txt
apps/api/src/modules/[context]/
  domain/
    entities/
    ports/
    services/
    events/
  application/
    use-cases/
  infrastructure/
    repositories/
    adapters/
  presentation/
    http/
  [context].module.ts
```

Rules:
- Domain is pure.
- Application orchestrates.
- Infrastructure implements ports.
- Controllers stay thin.
- Use-cases are verb-named.
- Shared types hold interfaces only.

## Active Contexts

- checkout: sessions, events, scoring, chat, offers, dashboard read model
- auth: merchant registration, JWT login, auth cookie
- merchant: merchant rules and configuration
- agent-rules: agent identity, capabilities, guardrails
- checkout-settings: widget behavior, triggers, suppression
- buyer-purchase-history: buyer personalization per merchant
- negotiation: M2M negotiation sessions and cost ledger
- payment: Asaas payment intents and webhooks
- commerce: Shopify order sync
- embed: storefront embed session tokens

## Critical Invariants

- LLM never authorizes offers.
- `conversation-engine` classifies objections and writes copy only.
- Discounts approved only by `rules-engine`.
- Shipping subsidies approved only by `shipping-engine`.
- Always validate generated messages with `isSafeGeneratedMessage`.
- Unsafe generated messages must fall back to deterministic safe templates.
- Never claim unauthorized discounts, free shipping, delivery guarantees, stock guarantees, payment confirmation, or request CVV/password.
- `merchant_id` is the tenant boundary.
- Every query and command must be scoped by `merchant_id`.
- `global_user_id` identifies buyers platform-wide.
- Purchase history is always filtered per merchant.
- Offer math must be deterministic.
- `evaluateDiscountOffer` hard-caps `maxDiscountPercent`.
- Reject offers below `minimumMarginPercent`.
- Margin uses item `cost`; if missing, default cost = 50% of price.
- Payment fee estimate = 4%.
- In-memory repos are dev/test default.
- Prisma repos are production mode.
- Prisma schema lives at `apps/api/prisma/schema.prisma`.

## Spec Workflow

Use `.specs/` before changing:
- public APIs
- domain rules
- persistence
- integrations
- user-facing behavior

Required:

```txt
.specs/features/[feature]/spec.md
.specs/features/[feature]/design.md
.specs/features/[feature]/tasks.md
```

Reference:

```txt
.specs/codebase/STACK.md
.specs/codebase/TESTING.md
.specs/codebase/INTEGRATIONS.md
.specs/codebase/CONCERNS.md
```

## Implementation Rules

- Keep changes small and focused.
- Do not bypass safety engines.
- Do not mix tenant data.
- Do not add hidden global state.
- Do not add dependencies without reason.
- Update shared types when contracts change.
- Add/update tests for behavior changes.
- Run typecheck before claiming done.
- Run build before claiming release-ready.

## Debug Protocol

1. Reproduce.
2. Isolate app/package.
3. Use context-mode for large logs.
4. Inspect minimal files.
5. Patch smallest safe surface.
6. Run focused test.
7. Run typecheck/build.
8. Summarize changes and verification.

## Search Protocol

- Search first.
- Open only relevant files.
- Use scripts for repo-wide checks.
- Keep findings short.
- Cite file paths and exact symbols.

## Git

Use Conventional Commits. English only. Subject line ≤72 chars.
No multi-line body unless absolutely necessary.
Imperative mood: "add", "fix", "remove" — not "added", "fixes".

Format: `type(scope): short description`

Types: `feat` `fix` `refactor` `test` `chore` `docs` `style` `perf` `ci`

Scopes: match module/app name — `checkout` `payment` `widget` `auth` `api` `shared-types` etc.

Examples:

```txt
feat(checkout): add scoped mission budget validation
fix(payment): enforce merchant boundary on webhook lookup
fix(widget): remove invisible input text in dark theme
refactor(auth): extract buyer session guard to hook
test(widget): add shipping selector regression tests
chore(deps): update pnpm lockfile
```

Rules:
- One logical change per commit
- Never commit secrets or .env files
- Never use `git add -A` or `git add .`
- Stage files by name only
