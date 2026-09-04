# ADR-016 — Store-settings uses deep merge

**Status:** PROPOSED (P1)
**Module:** `store-settings`
**Issue:** P1-011

---

## Context

`update-seo-settings.use-case.ts:32-46` does `{...existing.seo, ...input.seo}` — shallow merge. Body `seo = { description: "x" }` deletes `title/keywords/etc`.

Same in `store-settings.controller.ts:115-126` for `cross-sell-config`.

---

## Decision

Deep-merge at the use-case layer. Document PUT contract: top-level keys replace; nested keys merge.

---

## Implementation Steps

1. Add `mergeDeep(target, source)` helper to `shared/utils/`.
2. Refactor `update-seo-settings.use-case.ts` to deep-merge SEO + GTM + pixelIds.
3. Refactor `cross-sell-config` controller.
4. Tests with adversarial payloads.

---

## Files Touched

- `apps/api/src/modules/store-settings/application/use-cases/update-seo-settings.use-case.ts`
- `apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:115-126`
- `apps/api/src/shared/utils/deep-merge.ts` (new)
- Tests
