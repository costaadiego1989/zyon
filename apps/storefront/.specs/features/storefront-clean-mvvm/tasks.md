# Tasks: Storefront Clean MVVM Refactor

Gate after every task: `cd apps/storefront && pnpm typecheck`. Build+e2e at T13.

## Phase 1 — Comment removal (R1)

### T1 — strip-comments script + run
- What: Create `apps/storefront/scripts/strip-comments.mjs` (TS-API tokenizer). Run over `src/**/*.{ts,tsx}`.
- Done when: 0 comments in src (`grep -rn '//\|/\*' src` → only false positives inside strings/regex), `"use client"` intact.
- Gate: typecheck passes.
- Depends on: none.

## Phase 2 — Shared foundation (R2.2)

### T2 — services/http.ts + utils
- What: Extract `apiCall`/`getToken`/`friendlyApiError`/`API_ERROR_MESSAGES` from `useBuyerHub.ts` → `lib/services/http.ts`. Extract color helpers from `ProductCardBlock` → `lib/utils/color.ts`. Extract `formatPhone`/`formatCEP`/`maskCPF` → `lib/utils/format.ts`.
- Done when: files exist, exported, no behavior change.
- Gate: typecheck.
- Depends on: T1.

## Phase 3 — Viewmodels (R2.4, R4.2)

### T3 — useBuyerHub split [P]
- What: Move all loaders/mutations → `lib/services/buyer-hub.service.ts` (consuming http.ts). Keep state hook in `lib/viewmodels/useBuyerHub/index.ts` (barrel preserves `@/lib/viewmodels/useBuyerHub` import). Each file <300L.
- Done when: `useBuyerHub` under 300L, service holds data logic.
- Gate: typecheck.
- Depends on: T2.

### T4 — useConversationViewModel split [P]
- What: Move `restoreConversation`/persist/`narrateStorefrontBlock`/api → `services/conversation.service.ts`; event orchestration → `handlers/conversation.handlers.ts`; state hook → `viewmodels/useConversationViewModel/index.ts` barrel.
- Done when: hook <300L.
- Gate: typecheck.
- Depends on: T2.

### T5 — useSupportPanel (new VM from SupportPanel)
- What: Create `services/support.service.ts` (checkout-token, faq/public, chat/public fetch), `handlers/support.handlers.ts`, `viewmodels/useSupportPanel.ts`.
- Done when: VM owns state; service owns fetch.
- Gate: typecheck.
- Depends on: T2.

## Phase 4 — Decouple API-coupled components (R3)

### T6 — Rewire 13 components to services/viewmodels
- What: `SupportPanel` uses `useSupportPanel`. `ProductCarouselBlock`, `BuyerHubPanel`, `ProfileTab`, `BuyerLoginForm`, `BuyerRegistrationForm`, `CheckoutPanel`, `CheckoutWidgetPanel`, `ConversationShell`, `ReturnRequestForm`, `StoriesRow`, `WidgetConfigProvider`, `conversation/checkout-redirect.ts` route fetch through a service (reuse existing or add to service files).
- Done when: `grep -rln 'apiClient\|fetch(\|storefront-api' src/components` → empty.
- Gate: typecheck.
- Depends on: T3, T4, T5.

## Phase 5 — Split large components (R4.1)

### T7 — ProductCardBlock split [P]
- What: `blocks/parts/StarRating.tsx`, `ProductCardMedia.tsx`, `ProductCardCta.tsx`; use `utils/color.ts`. Thin parent.
- Done when: all <500L (target <300).
- Gate: typecheck.
- Depends on: T2.

### T8 — ProfileTab split [P]
- What: `buyer-hub/icons.tsx`, `tabs/parts/{AddressForm,AddressCard,EditField,ProfileSkeleton}.tsx`. Thin tab.
- Gate: typecheck.
- Depends on: T2, T6.

### T9 — BuyerHubPanel split [P]
- What: `buyer-hub/parts/{PhoneLoginForm,TabBar}.tsx`, `buyer-hub/tab-defs.ts`. Thin panel.
- Gate: typecheck.
- Depends on: T6.

### T10 — Remaining buyer-hub tabs [P]
- What: Split `PreferencesTab`, `TrackingTab`, `ConversationsTab`, `LoyaltyTab` into `tabs/parts/*`. Each <500L.
- Gate: typecheck.
- Depends on: T2, T6.

### T11 — ConversationShell split [P]
- What: extract render sections → `conversation/parts/*`. Thin shell.
- Gate: typecheck.
- Depends on: T4, T6.

### T12 — BuyerRegistrationForm split [P]
- What: field groups → `parts/*`; submit via service. Thin form.
- Gate: typecheck.
- Depends on: T2, T6.

## Phase 6 — Final verification (R5)

### T13 — Full gate
- What: `pnpm typecheck && pnpm build && pnpm e2e`.
- Done when: all green; assert 0 files >500L, 0 comments, 0 component API imports.
- Depends on: T1–T12.

## Traceability

| Req | Tasks |
|---|---|
| R1 | T1 |
| R2 | T2,T3,T4,T5 |
| R3 | T6 |
| R4 | T3,T4,T7,T8,T9,T10,T11,T12 |
| R5 | T13 |
