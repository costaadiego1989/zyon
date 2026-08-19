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

## Pending Verification

- API typecheck (contracts module has issues — defer until tests run cleanly)
- E2E: navigate settlements tab → list loads → click detail → panel opens
- Dashboard build + serve

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
