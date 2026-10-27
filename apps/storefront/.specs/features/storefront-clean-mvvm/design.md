# Design: Storefront Clean MVVM Refactor

## Target Architecture

```
src/
  app/                      # Next routes (unchanged behavior)
  components/               # PRESENTATION ONLY — JSX, props in, callbacks out
    <feature>/
      <Component>.tsx
      parts/                # extracted subcomponents (<300L each)
      icons.tsx            # extracted inline SVG icon components
  lib/
    services/               # API/DATA — fetch, transforms, domain rules (no React)
      http.ts              # shared authed fetch (from useBuyerHub.apiCall)
      buyer-hub.service.ts
      support.service.ts
      conversation.service.ts
      product.service.ts   # product/marketplace fetches
    handlers/               # UI EVENT logic extracted from components (framework-light)
      support.handlers.ts
      conversation.handlers.ts
      buyer-auth.handlers.ts
    viewmodels/             # REACT STATE + orchestration (hooks)
      useConversationViewModel/  # split by concern -> barrel
      useBuyerHub/               # split by concern -> barrel
      useSupportPanel.ts
    utils/                  # pure helpers (color, format, mask)
      color.ts
      format.ts
    types.ts
```

## Layer Contracts

- **components**: import from `viewmodels` and `utils` only. Never import `services`, `api-client`, `storefront-api`, `server-client`, or call `fetch`.
- **viewmodels**: own React state/effects. Call `services` for data and `handlers` for event orchestration. Return a plain VM object.
- **services**: pure async functions returning typed data. No React imports. Wrap `http.ts`.
- **handlers**: pure functions taking VM setters/params, returning nothing or data. No JSX.
- **utils**: pure sync helpers. No React, no fetch.

## Decomposition Plan (files >500L)

| File | Lines | Split into |
|---|---|---|
| `blocks/ProductCardBlock.tsx` | 1015 | `utils/color.ts` (color tokens/hex/luminance), `blocks/parts/StarRating.tsx`, `blocks/parts/ProductCardMedia.tsx`, `blocks/parts/ProductCardCta.tsx`, thin `ProductCardBlock.tsx` |
| `buyer-hub/tabs/ProfileTab.tsx` | 754 | `buyer-hub/icons.tsx` (13 icons), `tabs/parts/AddressForm.tsx`, `tabs/parts/AddressCard.tsx`, `tabs/parts/EditField.tsx`, `tabs/parts/ProfileSkeleton.tsx`, thin `ProfileTab.tsx` |
| `viewmodels/useConversationViewModel.ts` | 745 | `services/conversation.service.ts` (restore/persist/narrate/api), `handlers/conversation.handlers.ts`, `viewmodels/useConversationViewModel/` (state hook + barrel) |
| `buyer-hub/BuyerHubPanel.tsx` | 741 | `buyer-hub/parts/PhoneLoginForm.tsx`, `buyer-hub/parts/TabBar.tsx`, `buyer-hub/tab-defs.ts` (TABS), thin `BuyerHubPanel.tsx` |
| `components/SupportPanel.tsx` | 736 | `services/support.service.ts` (token/faq/chat fetch), `handlers/support.handlers.ts`, `viewmodels/useSupportPanel.ts`, thin `SupportPanel.tsx` |
| `viewmodels/useBuyerHub.ts` | 733 | `services/http.ts` (apiCall), `services/buyer-hub.service.ts` (all loaders/mutations), `viewmodels/useBuyerHub/` (state hook + barrel) |
| `buyer-hub/tabs/PreferencesTab.tsx` | 704 | `tabs/parts/*` subcomponents + thin tab |
| `ConversationShell.tsx` | 659 | extract render sections to `conversation/parts/*` + keep shell thin |
| `buyer-hub/tabs/TrackingTab.tsx` | 625 | `tabs/parts/TrackingCard.tsx` + timeline part + thin tab |
| `buyer-hub/tabs/ConversationsTab.tsx` | 606 | `tabs/parts/*` + thin tab |
| `buyer-hub/tabs/LoyaltyTab.tsx` | 581 | `tabs/parts/*` + thin tab |
| `BuyerRegistrationForm.tsx` | 556 | `services` for submit + `parts/*` field groups + thin form |

## Comment Removal Strategy

Node script `apps/storefront/scripts/strip-comments.mjs`:
- Uses TypeScript compiler API (`typescript` is already a devDep) to tokenize and remove `SingleLineCommentTrivia` + `MultiLineCommentTrivia`.
- TS-API tokenization guarantees strings/regex/JSX text are never touched (R1.3).
- Preserves `"use client"`/`"use server"` (they are string statements, not comments).
- Idempotent; walks `src/**/*.{ts,tsx}`.
- Run, then `pnpm typecheck` to confirm no breakage.

## Migration Order (safety first)

1. Comment removal (mechanical, whole tree) → typecheck.
2. Extract shared `services/http.ts` + `utils/*` (no consumers change behavior).
3. Refactor viewmodels (useBuyerHub, useConversation, useSupportPanel) → typecheck each.
4. Decouple the 13 API-coupled components to use services/viewmodels → typecheck.
5. Split remaining large components into `parts/` → typecheck each.
6. Final: build + e2e.

## Risk Controls

- Behavior-preserving: move code, don't rewrite logic.
- Barrels keep external import paths stable.
- typecheck gate after every phase; build+e2e at end.
- One file group per commit.
