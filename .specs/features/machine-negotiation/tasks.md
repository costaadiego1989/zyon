# Machine Negotiation Tasks

- [x] MN-T001 Create spec/design/tasks for machine negotiation.
  - Covers: MN-REQ-001 through MN-REQ-009.

- [x] MN-T002 Implement pure `@aacp/negotiation-engine`.
  - Covers: policy resolution, buyer preferences, cost caps, and agreement output.

- [x] MN-T003 Add deterministic test battery.
  - Covers: global/category/item, no overlap, disabled negotiation, and AI cost caps.

- [x] MN-T003A Add protected negotiation evaluation endpoint.
  - Covers: `POST /negotiations/evaluate`, deterministic engine wiring, authenticated merchant scoping, and controller/use-case tests.

- [x] MN-T004 Wire negotiation policy into merchant/agent-rules API.
  - Implemented as **`GET /merchant-negotiation-policy`** and **`PUT /merchant-negotiation-policy`** (JWT merchant scope; persists policy JSON). Persisted defaults feed `POST /negotiations/evaluate` when `merchantPolicy` is omitted. Gate: `merchant-negotiation-policy.controller.spec.ts`.

- [x] MN-T005 Add buyer-agent preference module.
  - **`GET /buyer-agent/preferences?global_user_id=`** (optional query; defaults returned when missing) and **`PUT /buyer-agent/preferences?global_user_id=`** (required query). Persistence tenant-scoped by `(merchant_id, global_user_id)`. Gate: `buyer-agent-preferences.use-cases.spec.ts`.

- [x] MN-T006 Add negotiation session persistence and cost ledger.
  - Prisma tables `merchant_negotiation_policies`, `buyer_agent_negotiation_preferences`, `negotiation_sessions`, `negotiation_cost_ledger_entries` + migration `20260503140000_negotiation_persistence`. `POST /negotiations/evaluate` persists session + **`negotiation.evaluated`** ledger line. Runtime store: memory by default; set **`NEGOTIATION_REPOSITORY=prisma`** with `DATABASE_URL` for Prisma. Gate: exercised via controller + apply use case specs (Prisma-only int-spec optional).

- [x] MN-T007 Connect negotiation agreement to checkout authorized offers.
  - **`POST /negotiations/apply-checkout-offer`** with `{ negotiation_session_id, checkout_session_id, requested_discount_percent }`; verifies fingerprint + deterministic snapshot + `@aacp/rules-engine` authorization; saves `AuthorizedOffer` via checkout repository.

- [ ] MN-T008 Add live machine-to-machine AI negotiation e2e.
  - Placeholder **`negotiation.live-m2m.e2e-spec.ts`** skipped unless **`RUN_REAL_AI_E2E=true`**; deterministic + apply flow covered elsewhere. Gate: full dual-agent LLM loop still deferred.
