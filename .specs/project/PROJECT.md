# Marketplace Dashboard Completion

**Date:** 2026-08-19  
**Status:** In Progress  
**Scope:** Complete dashboard UI gaps + payment chargeback tracking (both marketplace and checkout payment chargebacks)

## Vision

Enable sellers to monitor and manage marketplace settlements, chargebacks, and outstanding debts in real-time through the dashboard. Enable merchants to view and resolve payment chargebacks from their checkout flow.

## Goals

1. **Seller Settlements Dashboard** — visual timeline of settlement states, transfer windows, chargeback windows
2. **Debt Manager** — outstanding debt ledger, deduction history, resolution tracking
3. **Blocked Merchants Manager** — add/remove/manage blocked sellers from marketplace
4. **Marketplace Chargeback UI** — view chargebacks, state transitions, impact on settlements
5. **Payment Chargeback Dashboard** — merchant payment chargebacks (from checkout), dispute lifecycle
6. **Real-time Notifications** — toast alerts on settlement state changes, chargebacks, debt events

## Constraints

- API layer already built (use-cases, repos, state machine, tests)
- Dashboard must remain client-side React, no backend rendering
- Must support both marketplace (seller) and payment (merchant) chargebacks
- Debt must integrate with settlement view (show deduction impact)
- All endpoints must be wired in API controller + dashboard client

## Architecture Decisions

- **Settlement Timeline Component** — show date windows, current state, action buttons
- **Debt Ledger** — outstanding list, deduction history, resolve actions
- **Chargeback Panel** — separate tab or modal per flow (marketplace vs payment)
- **Blocked Merchants** — inline manager in settings with search/add/remove
- **Notifications** — webhook → polling fallback (no real-time initially)

## Non-Goals (Future)

- Automatic debt resolution
- Seller marketplace analytics
- Chargeback dispute forms
- Multi-merchant chargeback aggregation
