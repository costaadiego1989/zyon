# Marketplace Dashboard: Core Settlement Visibility

**Status:** Ready for Implementation  
**Scope:** API controller wiring + Settlement Timeline UI + Settlement Detail Panel  
**Estimate:** 2-3 days (includes tests)

---

## Requirements

### R1: Dashboard Controller Endpoints

All seller scoped by `merchant_id` (from auth context).

#### R1.1 GET /marketplace/dashboard/stats
- **Input:** Authorization header (extract merchant_id)
- **Output:** SellerStats (pending orders, monthly revenue, monthly commission, items shipped, fulfillment rate)
- **Uses:** `GetSellerStatsUseCase`
- **Tests:** 
  - Valid merchant → 200 + stats
  - No orders → 0 counts
  - Return window orders excluded from pending

#### R1.2 GET /marketplace/dashboard/orders
- **Input:** merchant_id (auth)
- **Output:** MarketplaceOrder[] (line items with fulfillment status, amounts, seller net, commission)
- **Uses:** `GetSellerOrdersUseCase`
- **Tests:**
  - Valid merchant → orders list
  - Different seller → 403
  - Empty merchant → []

#### R1.3 GET /marketplace/dashboard/settlements
- **Input:** merchant_id, filter params (status, created_after, created_before)
- **Output:** MarketplaceSettlement[] (id, status, order refs, seller net, created, windows)
- **New Use-case:** `ListSellerSettlementsUseCase`
- **Tests:**
  - List all → all settlements for seller
  - Filter by status (awaiting_return_window, transfer_scheduled, etc.) → only matching
  - Date range → only in range
  - Different seller → 403

#### R1.4 GET /marketplace/dashboard/settlements/:settlementId
- **Input:** settlementId, merchant_id (auth)
- **Output:** SettlementDetail (settlement + line items + windows + state transitions + timeline)
- **New Use-case:** `GetSettlementDetailUseCase`
- **Tests:**
  - Valid settlement + seller → 200
  - Different seller → 403
  - Not found → 404
  - Timeline includes all past + current state

---

### R2: Settlement Timeline Component

**File:** `apps/dashboard/src/pages/marketplace/components/SettlementTimeline.tsx`

#### R2.1 Display State Machine
```
[awaiting_return_window] → return_window_until → [transfer_scheduled] → [transferred] → chargeback_until → [finalized]
                 ↓ buyer_returned
           [return_cancelled]
                 ↓ chargeback_received
           [chargeback_cancelled]
```

#### R2.2 Visual Elements
- **State Badge:** Current status with color coding (blue=waiting, green=success, yellow=caution, red=risk)
- **Timeline Line:** Horizontal line connecting state circles
- **Date Windows:** Below line, show return_window_until, chargeback_window_until
- **Actions:** Button for each possible transition (if merchant can trigger — e.g., "Marcar como devolvido")
- **Timestamps:** Show actual dates for each state transition

#### R2.3 Responsive
- Mobile: Stack vertically
- Desktop: Horizontal timeline
- Accessible: ARIA labels, keyboard navigation

#### R2.4 Props
```typescript
interface SettlementTimelineProps {
  settlement: SettlementDetail;
  onStateChange?: (newStatus: SettlementStatus) => Promise<void>;
  isLoading?: boolean;
}
```

#### R2.5 Tests
- Render all 7 states correctly
- Show windows with formatted dates
- Action button disabled if state has no transition
- Loading spinner while processing
- Error toast if state change fails

---

### R3: Settlement Detail Panel

**File:** `apps/dashboard/src/pages/marketplace/components/SettlementDetailPanel.tsx`

#### R3.1 Content Sections
1. **Header:** Settlement ID, status badge, created date
2. **Order Reference:** Order IDs, total items, seller net, commission breakdown
3. **Timeline Component** (R2)
4. **Debt Section:** If status = chargeback_debt, show: debt ID, amount, status, link to debt ledger
5. **Actions:** Edit (if allowed), mark as delivered, view orders

#### R3.2 Props & Usage
```typescript
interface SettlementDetailPanelProps {
  settlementId: string;
  onClose?: () => void;
}

// In MarketplacePage orders tab:
<SettlementDetailPanel 
  settlementId={selectedSettlement.id} 
  onClose={() => setSelectedSettlement(null)} 
/>
```

#### R3.3 Data Fetching
- Load via `useApi().getMarketplaceSettlementDetail(settlementId)`
- Show loading skeleton while fetching
- Error state with retry button

#### R3.4 Tests
- Render settlement detail correctly
- Timeline renders inside panel
- Debt section visible only when debt exists
- Close button works

---

### R4: Integration in MarketplacePage

#### R4.1 Orders Tab Changes
```
Current: MarketplacePage shows orders list with markShipped/markDelivered buttons

New: Click order row → open SettlementDetailPanel as modal
     Panel shows full timeline + debt info + actions
```

#### R4.2 Props to useMarketplacePage Hook
- Add: `settlements`, `selectedSettlement`, `setSelectedSettlement`, `settlementsLoading`
- Fetch settlements on mount: `await getMarketplaceSettlements()`
- Fetch detail on row click: `await getMarketplaceSettlementDetail(id)`

#### R4.3 CSS Classes
- `.marketplace-page__settlements-modal`
- `.settlement-detail-panel`
- `.settlement-timeline`
- `.settlement-timeline__state`
- `.settlement-timeline__window`

#### R4.4 Tests
- Navigate to orders tab → list loads
- Click order row → panel opens with detail
- Panel has timeline visible
- Close button hides panel

---

## Design Decisions

1. **Settlement Panel as Modal** — keeps MarketplacePage clean, reusable panel
2. **useApi Hook** — fetch at hook level, panel is presentational
3. **State Machine as Source of Truth** — never hardcode transitions in UI
4. **Date Formatting** — use en-BR locale, show timezone
5. **Error Handling** — toast on API failure, retry button on panel

---

## Tasks (Atomic, ordered)

- [ ] [T1] Create `ListSellerSettlementsUseCase` + tests
- [ ] [T2] Create `GetSettlementDetailUseCase` + tests
- [ ] [T3] Wire `MarketplaceController`: stats, orders, settlements, detail endpoints
- [ ] [T4] Create `SettlementTimeline` React component + CSS + snapshots
- [ ] [T5] Create `SettlementDetailPanel` React component + CSS
- [ ] [T6] Update `useMarketplacePage` hook: settlements state + fetching
- [ ] [T7] Update `MarketplacePage`: render panel modal in orders tab
- [ ] [T8] Dashboard API endpoints: add getMarketplaceSettlements, getMarketplaceSettlementDetail
- [ ] [T9] E2E: navigate orders tab → select order → panel opens with timeline
- [ ] [T10] E2E: verify settlement state transitions render correctly

---

## Verification Gates

- [ ] All unit tests pass (use-cases, components, hooks)
- [ ] All E2E tests pass
- [ ] TypeCheck: `cd apps/api && pnpm typecheck` ✓
- [ ] TypeCheck: `cd apps/dashboard && pnpm typecheck` ✓
- [ ] Build: `cd apps/api && pnpm build` ✓
- [ ] Build: `cd apps/dashboard && pnpm build` ✓
- [ ] Settlement state machine transitions verified in UI
- [ ] No cross-tenant data leaks (merchant_id enforced)
- [ ] Date windows display correctly (return, chargeback)

---

## References

- **State Machine:** `apps/api/src/modules/marketplace/domain/services/settlement-state-machine.service.ts`
- **Settlement Repo:** `apps/api/src/modules/marketplace/infrastructure/repositories/prisma-marketplace-settlement.repository.ts`
- **Existing E2E:** `apps/dashboard/e2e/marketplace.spec.ts`
- **Existing Hook:** `apps/dashboard/src/pages/marketplace/useMarketplacePage.ts`
