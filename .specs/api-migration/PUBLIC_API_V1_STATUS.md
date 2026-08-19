# Public API v1 — Implementation Status

> Source of truth for REST v1 headless API surface.
> Last updated: 2026-08-18

## Architecture

- Pattern: Thin presentation layer delegating to existing use-cases
- Location: `apps/api/src/modules/public-api/{resource}/`
- Structure per resource:
  ```
  {resource}/
    presentation/http/{resource}-v1.controller.ts
    presentation/http/dtos/{resource}.dtos.ts
    application/mappers/{resource}-entity.mapper.ts
    public-api-{resource}.module.ts
  ```
- Barrel: `apps/api/src/modules/public-api/public-api.module.ts`
- Routes registered in: `apps/api/src/shared/http/api-documentation.ts` → `PUBLIC_OPERATIONS`
- Auth: `TenantCredentialGuard` + `TenantAccessGuard` + `@RequireTenantAccess`
- Envelope: `@UseInterceptors(ResponseEnvelopeInterceptor)` → `{ data, meta, pagination? }`
- Pagination: `CursorPaginationHelper` (cursor = base64 JSON)
- Idempotency: `@Idempotent()` on mutations
- Wire format: snake_case (DTOs transform to/from camelCase domain)

## ✅ Implemented (Phase 1 — 25 endpoints)

### Checkouts (8 endpoints)
| Method | Path | Use-Case | Status |
|--------|------|----------|--------|
| POST | /checkouts | StartCheckoutUseCase | ✅ |
| GET | /checkouts/:id | GetCheckoutSessionUseCase | ✅ |
| POST | /checkouts/:id/events | TrackCheckoutEventUseCase | ✅ |
| POST | /checkouts/:id/messages | SendChatMessageUseCase | ✅ |
| POST | /checkouts/:id/shipping/evaluate | EvaluateShippingUseCase | ✅ |
| POST | /checkouts/:id/offers | ApplyOfferUseCase | ✅ |
| POST | /checkouts/:id/complete | CompleteOrderUseCase | ✅ |
| PATCH | /checkouts/:id/cart | UpdateCartUseCase | ✅ |

### Orders (5 endpoints)
| Method | Path | Use-Case | Status |
|--------|------|----------|--------|
| GET | /orders | ListOrdersUseCase | ✅ |
| GET | /orders/:id | GetOrderUseCase | ✅ |
| POST | /orders/:id/cancel | CancelOrderUseCase | ✅ |
| GET | /orders/:id/tracking | GetOrderUseCase → mapper | ✅ |
| PATCH | /orders/:id/tracking | UpdateOrderStatusUseCase | ✅ |

### Products (5 endpoints)
| Method | Path | Use-Case | Status |
|--------|------|----------|--------|
| GET | /products | SearchProductsUseCase | ✅ |
| GET | /products/:id | GetProductUseCase | ✅ |
| POST | /products | AddProductUseCase | ✅ |
| PATCH | /products/:id | UpdateProductUseCase | ✅ |
| DELETE | /products/:id | DeleteProductUseCase | ✅ |

### Settings (4 endpoints)
| Method | Path | Use-Case | Status |
|--------|------|----------|--------|
| GET | /settings/checkout | GetCheckoutSettingsUseCase | ✅ |
| PUT | /settings/checkout | UpdateCheckoutSettingsUseCase | ✅ |
| GET | /settings/agent-rules | GetAgentRulesUseCase | ✅ |
| PUT | /settings/agent-rules | UpdateAgentRulesUseCase | ✅ |

### Payments (3 endpoints)
| Method | Path | Use-Case | Status |
|--------|------|----------|--------|
| POST | /payments/intents | CreatePaymentIntentUseCase | ✅ |
| GET | /payments/intents/:id | GetPaymentIntentStatusUseCase | ✅ |
| POST | /payments/intents/:id/confirm | ConfirmStripePaymentUseCase | ✅ |

## 🔲 Remaining Modules (Phase 2)

### P1 — Customers & Buyer Data
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /customers | buyer-purchase-history | P1 |
| GET | /customers/:id | buyer-purchase-history | P1 |
| GET | /customers/:id/orders | operations + buyer-purchase-history | P1 |

### P1 — Categories
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /categories | ListCategoriesUseCase (catalog) | P1 |
| POST | /categories | CreateCategoryUseCase (catalog) | P1 |
| PATCH | /categories/:id | UpdateCategoryUseCase (catalog) | P1 |
| DELETE | /categories/:id | DeleteCategoryUseCase (catalog) | P1 |
| PUT | /categories/reorder | ReorderCategoriesUseCase (catalog) | P1 |

### P1 — Coupons
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /coupons | (need ListCouponsUseCase — may need to create) | P1 |
| POST | /coupons | (need CreateCouponUseCase — may need to create) | P1 |
| PATCH | /coupons/:id | (need UpdateCouponUseCase — may need to create) | P1 |
| DELETE | /coupons/:id | (need DeleteCouponUseCase — may need to create) | P1 |
| POST | /coupons/:id/validate | ApplyCouponUseCase | P1 |

### P1 — Webhooks
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /webhooks | integrations (ListWebhookEndpoints) | P1 |
| POST | /webhooks | integrations (CreateWebhookEndpoint) | P1 |
| GET | /webhooks/:id | integrations (GetWebhookEndpoint) | P1 |
| PUT | /webhooks/:id | integrations (UpdateWebhookEndpoint) | P1 |
| DELETE | /webhooks/:id | integrations (DeleteWebhookEndpoint) | P1 |

### P2 — Analytics
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /analytics/dashboard | GetDashboardMetricsUseCase | P2 |
| GET | /analytics/products | GetProductPerformanceUseCase | P2 |
| GET | /analytics/products/:id | GetProductAnalyticsUseCase | P2 |
| GET | /analytics/offers/roi | GetOfferRoiUseCase | P2 |
| GET | /analytics/payments | GetPaymentMetricsUseCase | P2 |
| GET | /analytics/customers | GetCustomerMetricsUseCase | P2 |

### P2 — Experiments (A/B Testing)
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /experiments | ListExperimentsUseCase | P2 |
| POST | /experiments | CreateExperimentUseCase | P2 |
| GET | /experiments/:id | GetExperimentUseCase | P2 |
| PATCH | /experiments/:id | UpdateExperimentUseCase | P2 |
| POST | /experiments/:id/start | StartExperimentUseCase | P2 |
| POST | /experiments/:id/stop | StopExperimentUseCase | P2 |
| POST | /experiments/:id/archive | ArchiveExperimentUseCase | P2 |
| GET | /experiments/:id/results | GetExperimentResultsUseCase | P2 |
| POST | /experiments/:id/promote | PromoteWinnerUseCase | P2 |

### P2 — Cross-Sell
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /cross-sells | (need list use-case) | P2 |
| POST | /cross-sells | CreateCrossSellPromotionUseCase | P2 |
| GET | /cross-sells/eligible | ListEligibleCrossSellsUseCase | P2 |

### P2 — Shipping
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| POST | /shipping/quotes | ShippingQuotesModule | P2 |

### P2 — Fulfillment
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| POST | /fulfillment/shipments | CreateShipmentUseCase | P2 |
| GET | /fulfillment/shipments | (need list) | P2 |

### P2 — Returns
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| POST | /returns | RequestReturnUseCase | P2 |
| GET | /returns | ListReturnsUseCase | P2 |

### P2 — Store Settings
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /settings/store | GetStoreSettingsUseCase | P2 |
| PUT | /settings/store | UpdateStoreSettingsUseCase | P2 |
| GET | /settings/seo | GetSeoSettingsUseCase | P2 |
| PUT | /settings/seo | UpdateSeoSettingsUseCase | P2 |

### P2 — Support
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /support/settings | GetSupportSettingsUseCase | P2 |
| GET | /support/tickets | ListSupportTicketsUseCase | P2 |

### P3 — Team Management
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /team/members | ListTeamUseCase | P3 |
| POST | /team/invitations | InviteMemberUseCase | P3 |
| POST | /team/invitations/:id/accept | AcceptInviteUseCase | P3 |
| PATCH | /team/members/:id/role | UpdateRoleUseCase | P3 |
| DELETE | /team/members/:id | RemoveMemberUseCase | P3 |

### P3 — Domains
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /domains | ListDomainsUseCase | P3 |
| POST | /domains | RegisterDomainUseCase | P3 |
| POST | /domains/:id/verify | VerifyDomainUseCase | P3 |

### P3 — Notifications
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| POST | /notifications/order-confirmation | SendOrderConfirmationUseCase | P3 |
| POST | /notifications/order-shipped | SendOrderShippedUseCase | P3 |
| POST | /notifications/order-delivered | SendOrderDeliveredUseCase | P3 |
| POST | /notifications/return-approved | SendReturnApprovedUseCase | P3 |

### P3 — Audit
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /audit-events | (read-only query) | P3 |

### P3 — Onboarding
| Method | Path | Use-Case Source | Priority |
|--------|------|-----------------|----------|
| GET | /onboarding/status | (read state from repo) | P3 |
| POST | /onboarding/complete-step | (update state) | P3 |

## Implementation Checklist (per module)

- [ ] Controller with proper decorators
- [ ] Request DTOs with class-validator
- [ ] Response mapper (domain → snake_case)
- [ ] Module file importing source module
- [ ] Register in `public-api.module.ts`
- [ ] Add routes to `PUBLIC_OPERATIONS` in `api-documentation.ts`
- [ ] Source module exports required use-cases
- [ ] `pnpm typecheck` passes

## Notes

- Coupons module only exports `ApplyCouponUseCase` and `RedeemCouponUseCase` — CRUD use-cases need to be created or exposed from existing controller logic
- Webhooks: IntegrationsModule has controllers but use-cases may not be individually exported — check `integrations/` structure
- Buyer data: No "list customers" use-case exists — may need thin query use-case
- Cross-sell: No list-all use-case, only `ListEligibleCrossSells` (per checkout context)
- All P1 modules have use-cases ready or nearly ready
- P2/P3 modules may need new thin query use-cases for list operations
