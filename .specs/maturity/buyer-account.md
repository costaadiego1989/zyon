# buyer-account — Closure Sheet

- **Current level:** L2 (blocked)
- **Target level:** L3
- **Owner:** TBD
- **Priority:** P2
- **Included flows:** buyer login from session, profile, OTP
- **Excluded flows:** TBD
- **What's missing for L3 (ADR-0007):** Prova one-time no login por checkout; OTP CSPRNG e provider real; rate limit; criptografia de CPF/endereço; refresh/revogação.
- **Blocked by:** [P0 blockers](./p0-blockers.md) — P0.5 (providers reais), P0.3 (tenant).

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

## Accepted Risks
| Risk | Justification | Owner | Deadline |
|------|--------------|-------|----------|

## Links
- Migrations:
- Tests:
- Dashboards:
- Runbooks:
