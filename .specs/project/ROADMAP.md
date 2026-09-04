# Marketplace Dashboard Roadmap

## Phase 1: Core Settlement Visibility (Foundation)

### 1.1 Dashboard Module Controller
- Wire `GetSellerStatsUseCase` → `GET /marketplace/dashboard/stats`
- Wire `GetSellerOrdersUseCase` → `GET /marketplace/dashboard/orders`
- Create `GET /marketplace/dashboard/settlements` → list + filter
- Create `GET /marketplace/dashboard/settlements/:id` → detail + timeline

**Depends on:** API use-cases, repos (already done)  
**Deliverable:** API endpoints ready for dashboard client  
**Tests:** Controller unit + integration

### 1.2 Settlement Timeline Component
- Render settlement state machine as visual timeline
- Show windows: return, transfer, chargeback
- Display timestamps, status badge, action buttons
- Responsive, accessible

**Depends on:** 1.1  
**Deliverable:** React component + CSS  
**Tests:** Component snapshots, state transitions

### 1.3 Settlement Detail Panel
- Pull settlement data via API
- Show line items, seller info, amounts
- Render timeline component
- Link to debt ledger (if debt exists)

**Depends on:** 1.2  
**Deliverable:** Modal/panel in Orders tab  
**Tests:** E2E: navigate to settlement, verify state timeline

---

## Phase 2: Debt Management

### 2.1 Debt Repository + Use-case
- Implement `PrismaMarketplaceSellerDebtRepository`
- Create `GetSellerDebtsUseCase`
- Create `ResolveSellerDebtUseCase`
- Tests: unit + integration

**Depends on:** API module (Prisma schema should have debt table)  
**Deliverable:** Use-cases, full test coverage  
**Tests:** Unit tests for all methods

### 2.2 Debt API Endpoint
- `GET /marketplace/dashboard/debts` → seller outstanding debts
- `GET /marketplace/dashboard/debts/:id` → detail + deduction history
- `POST /marketplace/dashboard/debts/:id/resolve` → mark resolved (admin only)
- Validate merchant boundary

**Depends on:** 2.1  
**Deliverable:** Controller endpoints  
**Tests:** Unit + integration

### 2.3 Debt Ledger UI
- Render outstanding debts table
- Show: settlement ref, amount, status, created/resolved dates
- Deduction history (settlement where debt was deducted from)
- Link to settlement detail

**Depends on:** 2.2  
**Deliverable:** React component + CSS  
**Tests:** Component snapshots, data binding

### 2.4 Debt Integration with Settlement Timeline
- When settlement is `chargeback_debt`, show debt impact
- Show deduction history on settlement detail
- Link debt ledger from settlement

**Depends on:** 1.3, 2.3  
**Deliverable:** Connected UI  
**Tests:** E2E: create chargeback debt, verify settlement → debt link

---

## Phase 3: Marketplace Chargeback Management

### 3.1 Marketplace Chargeback Use-case Tests + Implementation
- `GetMarketplaceChargebacksUseCase` (list chargebacks for seller)
- `HandleMarketplaceChargebackUseCase` (already done, but verify integration)
- Tests: list by status, filter by settlement, date range

**Depends on:** API repos (already exist)  
**Deliverable:** Use-cases + full coverage  
**Tests:** Unit tests

### 3.2 Chargeback API Endpoints
- `GET /marketplace/dashboard/chargebacks` → seller chargebacks
- `GET /marketplace/dashboard/chargebacks/:id` → detail + state machine
- `POST /marketplace/dashboard/chargebacks/:id/acknowledge` → mark reviewed
- Filter/sort: status, settlement ref, date range

**Depends on:** 3.1  
**Deliverable:** Controller endpoints  
**Tests:** Unit + integration

### 3.3 Marketplace Chargeback Dashboard Tab
- New tab in MarketplacePage: "Chargebacks"
- Show chargeback list: settlement ref, amount, status, dates (return window end, chargeback window end)
- Detail view: timeline, settlement link, debt info (if `chargeback_debt`)
- Acknowledge button (dismiss notification)

**Depends on:** 3.2  
**Deliverable:** React component + CSS + hook  
**Tests:** E2E: navigate tab, filter, view details

---

## Phase 4: Blocked Merchants Management

### 4.1 Blocked Merchants Use-case
- `AddBlockedMerchantUseCase`
- `RemoveBlockedMerchantUseCase`
- `GetBlockedMerchantsUseCase`
- Validate merchant not already blocked, not self-block

**Depends on:** Marketplace config repo  
**Deliverable:** Use-cases + tests  
**Tests:** Unit tests, edge cases

### 4.2 Blocked Merchants API Endpoints
- `GET /marketplace/dashboard/config/blocked` → list
- `POST /marketplace/dashboard/config/blocked` → add (request: merchant_id)
- `DELETE /marketplace/dashboard/config/blocked/:merchantId` → remove
- Validate merchant_id exists, not duplicate

**Depends on:** 4.1  
**Deliverable:** Controller endpoints  
**Tests:** Unit + integration

### 4.3 Blocked Merchants UI
- Settings tab, "Lojas Bloqueadas" section
- Search/add form: merchant name or ID + search button
- List: merchant name, add date, remove button + confirmation
- Empty state: "Nenhuma loja bloqueada"

**Depends on:** 4.2  
**Deliverable:** React component + CSS  
**Tests:** E2E: add merchant, verify list, remove

---

## Phase 5: Payment Chargeback Dashboard (Checkout Module)

### 5.1 Payment Chargeback Use-cases
- `GetPaymentChargebacksUseCase` (merchant chargebacks from payment processing)
- `HandlePaymentChargebackUseCase` (create chargeback record on webhook)
- Status: pending, disputed, resolved, lost
- Tests: list, filter by status/date

**Depends on:** Payment module (webhook intake already exists)  
**Deliverable:** Use-cases + tests  
**Tests:** Unit tests

### 5.2 Payment Chargeback API Endpoints
- `GET /checkout/dashboard/chargebacks` → merchant chargebacks
- `GET /checkout/dashboard/chargebacks/:id` → detail + dispute status
- `POST /checkout/dashboard/chargebacks/:id/dispute` → submit dispute (if open)
- Filter: status, order ref, amount range

**Depends on:** 5.1  
**Deliverable:** Controller endpoints  
**Tests:** Unit + integration

### 5.3 Payment Chargeback Dashboard Tab
- New page or tab in Dashboard: "Chargebacks" (payment-specific)
- Show chargeback list: order ref, amount, status, dates (created, chargeback window end)
- Detail: customer info, order items, reason code, dispute status
- Dispute form if status = pending

**Depends on:** 5.2  
**Deliverable:** React component + CSS + hook  
**Tests:** E2E: navigate to chargebacks, view detail

---

## Phase 6: Notifications & Real-time Updates

### 6.1 Event Stream Setup
- Webhook handlers for settlement state changes, chargebacks, debt events
- Store events in DB (audit trail)
- Polling endpoint: `GET /marketplace/dashboard/events?since=timestamp`

**Depends on:** 1.1, 3.2, 5.2  
**Deliverable:** Event capture + polling endpoint  
**Tests:** Unit tests

### 6.2 Dashboard Event Polling Hook
- `useMarketplaceEvents()` — poll events every 10s
- Parse event type, trigger toast notifications
- Update settlement/chargeback state in real-time (if visible)

**Depends on:** 6.1  
**Deliverable:** React hook  
**Tests:** Unit tests (mock polling)

### 6.3 Toast Notifications
- Settlement transferred → "Transferência processada"
- Chargeback received → "Chargeback recebido"
- Debt created → "Débito criado por chargeback"
- Actions: dismiss, view detail

**Depends on:** 6.2  
**Deliverable:** Toast integration  
**Tests:** E2E: verify toast appears

---

## Milestones

| Milestone | Phases | Target |
|-----------|--------|--------|
| **MVP: Settlement Visibility** | 1, 2.1-2 | Week 1 |
| **Chargeback Management** | 3, 4 | Week 2 |
| **Payment Chargeback Parity** | 5 | Week 2 |
| **Notifications** | 6 | Week 3 |
| **Polish & E2E** | All | Week 4 |

---

## Testing Strategy

- **Unit:** Use-cases, repos, services (100% coverage required)
- **Integration:** API controllers + Prisma (with test DB)
- **Component:** React snapshots, user interactions
- **E2E:** Playwright tests for key flows (see TESTING.md)
- **Gate:** All tests pass, typecheck, build

## Risks

1. **Settlement state machine complexity** — verify all transitions before UI
2. **Debt deduction calculation** — must match financial rules
3. **Real-time sync** — polling may lag; consider WebSocket if needed later
4. **Merchant boundary** — ensure no cross-tenant data leaks

## Deferred (Future)

- Chargeback dispute forms
- Seller analytics (revenue trends, chargeback rate)
- Bulk operations (resolve multiple debts)
- Automated debt settlement from transfers
