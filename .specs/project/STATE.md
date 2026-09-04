# State

## Decisions

- [2026-08-19] Marketplace dashboard completion requires 6 phases
- [2026-08-19] API tests A/B done (chargeback + scheduled transfers), UI pending
- [2026-08-19] Payment chargeback is a SEPARATE concern from marketplace chargeback — separate page/flow
- [2026-08-19] Debt management ties into settlement timeline (cross-reference)
- [2026-08-19] Settlement state machine is source of truth for all transitions
- [2026-08-19] Polling before WebSocket — simplicity first

## Current Phase

**Phase 1 COMPLETE**. Ready: Phase 2 (Debt Management), Phase 3 (Marketplace Chargebacks)

## Completed

✅ **API Layer (Tests A/B)**
- Settlement state machine service + getAvailableEvents() method + tests A/B
- HandleMarketplaceChargebackUseCase + tests
- ProcessScheduledTransfersUseCase + tests
- GetSellerStatsUseCase + tests

✅ **Phase 1: Core Settlement Visibility**
- ListSellerSettlementsUseCase + wired in controller
- GetSettlementDetailUseCase + wired in controller
- MarketplaceController: GET /settlements, GET /settlements/:id endpoints
- SettlementTimeline React component + CSS (visual state machine)
- SettlementDetailPanel modal component + CSS
- Dashboard API v2 endpoints (marketplace-v2.ts)
- useMarketplacePage hook: settlements state + loading
- MarketplacePage: 4 tabs (Orders, Settlements, Chargebacks, Settings)
- Settlement status badges + styling
- Integration: settlement list → click detail → modal panel opens

## Blocked

(none)

## Todos (Phases 2-6)

- [ ] Phase 2: Debt Management (repo + API + UI ledger)
- [ ] Phase 3: Marketplace Chargeback tab
- [ ] Phase 4: Blocked merchants manager (add/remove UI)
- [ ] Phase 5: Payment chargeback page (separate)
- [ ] Phase 6: Notifications (polling + toasts)

## Active: Dashboard Corrections Sprint (2026-08-20)

**31 requirements, ~80 tasks, 4 weeks**

Spec at: `.specs/features/dashboard-corrections-sprint/`
- `spec.md` — 31 reqs with ACs
- `tasks.md` — 36 atomic tasks
- `context.md` — decisions + gray areas
- `SUMMARY.md` — quickstart
- `README.md` — navigation
- `BEST-PRACTICES.md` — coding guide

**Phase 1 (P0 Bugs) — COMPLETE ✅**
- T-001 ✅ Catalog render loop (useMemo)
- T-002 ✅ Categories import (default export)
- T-003 ✅ Signals crash (guard coupon.code)
- T-004 ✅ Preview rendering (docs + onError)
- T-005 ✅ Team disconnect (session guard)

**Phase 1 Analysis — COMPLETE ✅**
- T-006 ✅ Cart Recovery analysis (delivered)

**Phase 2 (P1 Features) — COMPLETE ✅**
- T-009 ✅ Dashboard metrics (7 StatCards)
- T-010 ✅ Orders CSV (date filter + UTF-8 BOM)
- T-011 ✅ Status badges (7 color variants)
- T-012 ✅ Tracking modal (readonly + status flow)
- T-013 ✅ Cross-sell store (3 toggles)
- T-014 ✅ Cross-sell checkout (same component)
- T-015 ✅ Funnel (11 steps + intelligent insights)
- T-017 ✅ Marketplace seeds (322 lines)
- T-018 ✅ M2M redesign (enterprise layout + creation)
- T-019 ✅ Revenue Manager (fix 404 + tabs + copy)

**Phase 3 (P2 Polish) — COMPLETE ✅**
- T-020 ✅ Theme store (seal, icons, upload, rounding)
- T-021 ✅ Phone masks (3 pages)
- T-022 ✅ Domain UX (SectionHeader + explanation)
- T-023 ✅ Checkout appearance audit (all options valid)
- T-024 ✅ Signals validation (priority copy added)
- T-025 ✅ Theme checkout (seal button primary)
- T-026 ✅ Protocol copy rewrite
- T-027 ✅ Intent Memory (KPIs + copy + data)
- T-028 ✅ Revenue Lift (StatCard + copy + demo badge)
- T-029 ✅ Cart Recovery std (SectionHeader + StatCard)

**Phase 4 (P3 Final) — COMPLETE ✅**
- T-030 ✅ AI agent casing
- T-031 ✅ Developers audit (content accurate)
- T-032 ✅ Commerce VTEX badge
- T-033 ✅ Payments crypto layout (2-col)
- T-034 ✅ Settings phone (covered by T-021)
- T-035 ✅ Billing button (Button variant outline)
- T-036 ✅ Food service (nested categories + modifiers)

**Remaining (blocked or deferred):**
- T-007 ⏸️ Stripe integration (needs credentials)
- T-008 ⏸️ Split validation (needs T-006 review + implementation)
- T-016 ⏸️ Negotiation policy fix (blocked by T-006 decision)

**Key blocker:** T-006 analysis delivered but requires team decision before T-008/T-016 implementation

## Pending Verification

- API typecheck (contracts module has issues — defer until tests run cleanly)
- E2E: navigate settlements tab → list loads → click detail → panel opens
- Dashboard build + serve
- **New:** All 5 P0 bugs fixed before Week 2 start
- **New:** T-006 analysis complete with recommendations

## Deferred Ideas

- WebSocket real-time push
- Seller analytics
- Automated debt resolution
- Chargeback dispute forms

## Lessons

- Keep marketplace and payment chargebacks as separate bounded contexts
- Settlement state machine validates before UI — never bypass
- React components for timeline + panel = reusable across dashboard
- useApi hook auto-includes new endpoints when api/index.ts imports them
