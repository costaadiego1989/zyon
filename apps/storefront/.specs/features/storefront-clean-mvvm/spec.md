# Spec: Storefront Clean MVVM Refactor

## Goal

Refactor `apps/storefront` for clean code and a coherent MVVM architecture without changing runtime behavior.

## Scope

`apps/storefront/src/**` only. No API, widget, dashboard, or package changes.

## Requirements

### R1 — Remove all comments
- R1.1: A script removes every comment (`//`, `/* */`, JSDoc, banner) from all `.ts` / `.tsx` files under `apps/storefront/src`.
- R1.2: No comments preserved. Zero exceptions.
- R1.3: Script must not touch string literals, template literals, regex, or JSX text that resemble comments.
- R1.4: `"use client"` / `"use server"` directives preserved.
- R1.5: Script is idempotent and re-runnable.

### R2 — MVVM layering
- R2.1: `components/` hold JSX + presentation only. No direct API calls, no fetch, no business rules.
- R2.2: `services/` hold API/data access, data transformation, and domain rules (pure, framework-light).
- R2.3: `handlers/` hold UI event logic (onClick/onSubmit/onScroll orchestration) extracted from components.
- R2.4: `viewmodels/` hold React state + orchestration, binding services/handlers to components via hooks.
- R2.5: Data flow: `component → viewmodel → (handlers + services)`. Components never import `api-client`/`storefront-api`/`server-client` directly.

### R3 — Decouple components from API
- R3.1: The 13 components with direct API coupling route all data access through a service.
- R3.2: Each service is single-responsibility and reusable across viewmodels.

### R4 — Break up large files (>500 lines)
- R4.1: Every `.ts`/`.tsx` in `src` over 500 lines is decomposed into cohesive units under 500 lines (target <300).
- R4.2: Large components split into subcomponents; large viewmodels split by concern into services/handlers + a thin coordinating hook.
- R4.3: Public import paths preserved via barrels (`index.ts`) where a file is consumed externally.

### R5 — Verification
- R5.1: `pnpm typecheck` passes with zero errors after every phase.
- R5.2: `pnpm build` passes after the final phase.
- R5.3: `pnpm e2e` passes (or matches the pre-refactor baseline) after the final phase.

## Non-Goals
- No feature/behavior changes.
- No dependency additions.
- No styling/UX changes.
- No API/package/widget edits.

## Constraints
- tsconfig path alias: `@/*` → `./src/*`.
- Next.js 15 App Router; `"use client"` boundaries must be preserved.
- Keep diffs mechanical and reviewable; behavior-preserving only.

## Acceptance
- 0 comments in `src`.
- 0 files >500 lines in `src`.
- 0 components importing API clients directly.
- typecheck + build + e2e green.
