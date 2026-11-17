## Handoff

- Features: agentic-dashboard-assistant and approved agentic-campaign-approval; Execute, one author.
- Checkout: C:/tmp/zyon-agentic-assistant-20261116; branch feat/agentic-assistant-20261116; baseline e750aa85. Preserve original AACP worktree.
- Base: T1-T56 committed through b6750a0e. Canonical tabs, compact settings, KPI/charts and filters, native desktop/mobile walk. T55 heap/lease correction; T56 acknowledgement survives equivalent refresh and JSONB key order. 121 UI, native ADAS-56 and ADAS-58 passed.
- ACAP: spec approved2026-11-16 user "Aprovar especificacao" (exact accented approval remains in spec); tasks approved user "Aprovar plano e implementar". T1 contracts complete in this commit: launch excluded from automatic-action type; preparation/review/contact/notice DTOs. Gates:436 API,10 WhatsApp,132 UI, builds/lint/types0.
- ACAP T2 complete in this commit: three tables, optional scoped notice FKs for new inbox/delivery rows, exact deploy mirrors including the base assistant prerequisite. Local migration smoke and builds/lint/types0;436 API,10 WhatsApp,132 UI.
- ACAP T3 complete in this commit: stable generation intent, canonical request digest, verified content readiness. Extracted existing pure draft/commercial validation to domain, keeping application re-exports.22 tests passed and lint0.
- ACAP T4 complete in this commit: PostgreSQL preparation repository, fenced leases, revisions, checkpoints, unknown-state hold and shared isolated DB fixture.9 integration cases and full457 API tests passed; lint0.
- ACAP T5 complete in this commit: administrative contact with explicit campaign_ready.v1 consent, version/CAS, role/tenant guards, self-send rejection and phone-free audit.9 PG tests and full466 API tests passed; lint0.
- ACAP T6 complete in this commit: deterministic per-review inbox/outbox, pinned recipient metadata, fenced dispatch marker/ledger, unknown hold, safe known-no-dispatch retry, closed-review recovery and scoped purge.20 PG tests; phase gate486 API,10 WhatsApp,132 UI, both builds/lint/types0.
- ACAP T7 complete: frozen launch draft/products/ordered verified media/assets and ACTIVE intent, with stale-media race guard.17 targeted and495 full API tests passed; lint0. Next T8 final authority; no remote actions.
- Next: ACAP T7 frozen launch proposal, then T8 authority and T9-T35 sequential. No preparation worker, new launch executor or real sends yet. Technical observations in ignored implementation-notes.md.
- Final integrated closure: both features remain pending clean-HEAD proofs, fresh independent Verifiers, mutations and validate_verification0 after the approved ACAP rule replaces initial auto launch in ADAS-34/57. Earlier incomplete proof runs never count green. No Verifier dispatched for this scope yet; do not reuse meta_growth_verifier.
- Single final Aprovar e publicar; all new campaigns require administrative approval. Notify administrative contact through the store WhatsApp only. Sender eligibility/template approval and real delivery remain separate operational proofs.
- Local only: no push/deploy, remote DB, paid calls, WhatsApp messages or Athom activation. Private .specs/features artifacts remain ignored; never force-add.

- ACAP T7 committed d692148e:17 proposal tests, full495 API and lint0. T8 next; final integrated proofs/Verifier still owed.

- ACAP T8 complete in this commit: automatic initial prepare/launch denied; publication requires authentic exact legacy receipt or confirmed administrative publication history. Launch revalidates frozen media/catalogue/assets and own progress IDs.9 new cases,57 targeted/full504 API, lint0. T9 next.
