# Widget: shipping-widget — Closure Sheet

- **Current level:** L2
- **Target level:** L3
- **Owner:** TBD
- **Priority:** P1
- **Included flows:** shipping selection in widget
- **Excluded flows:** TBD
- **What's missing for L3 (ADR-0007):** Confirmar seleção na API antes de atualizar total; estado de erro/retry; carrier real e expiração de quote.

## L3 Checklist (ADR-0007)
- [ ] Ownership and boundaries documented
- [ ] No cross-context dependency outside public port/event
- [ ] Boundary lint blocking in CI
- [ ] Request/response validated at runtime
- [ ] Routes have explicit auth/authz
- [ ] merchant_id never trusted from body
- [ ] Cross-tenant, replay, expiry, scope tested
- [ ] Critical state persisted (not in-memory)
- [ ] Migration tested on real DB with restart test
- [ ] No idempotency index, queue, wallet, coupon, quote or critical shipment only in memory
- [ ] Repeatable commands and webhooks are idempotent
- [ ] Aggregate writes and outbox are atomic when publishing facts
- [ ] Retry, compensation, and partial failure semantics documented
- [ ] Structured logs include correlation id and tenant
- [ ] Metrics cover success, error, latency, backlog
- [ ] Logs/traces don't expose secrets, PAN, CVV, or unnecessary PII
- [ ] Unit tests for invariants
- [ ] Integration tests with real persistence
- [ ] E2E for public/authenticated flow and main errors
- [ ] External integrations have controlled smoke or sandbox contract
- [ ] Config per env fails safely
- [ ] Failure, replay, rollback, reconciliation runbook exists
- [ ] Docs and tasks reflect current code
- [ ] Build, typecheck, lint, mandatory tests green
- [ ] No critical step uses continue-on-error
- [ ] Skips have justification, owner, deadline

## Widget L3 Requirements (ADR-0007)
- [ ] `widgetReloadKey` excludes `cart.total`; valid cart update never unmounts session
- [ ] Session/identity has explicit retention, expiry, consent policy
- [ ] E2E uses dedicated port / `strictPort`
- [ ] Gates: unit, mocked E2E, real-api E2E, mobile, axe, visual regression, build, bundle/TTI budget
- [ ] Real smokes cover declared providers/carriers/themes
- [ ] Large files split when they block testing critical states

## Accepted Risks
| Risk | Justification | Owner | Deadline |
|------|--------------|-------|----------|

## Links
- Tests:
- Dashboards:
- Runbooks:
