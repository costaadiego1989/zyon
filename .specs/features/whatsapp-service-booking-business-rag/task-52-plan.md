# T52: Claim the exact WhatsApp conversation

Assumptions: owner/admin/staff comes from real human tenant authentication, not the payload. Product and service merchants share handoff. Claim does not renew lifecycle/checkout or send externally. Existing widget commands keep their behavior. Only the canonical active ticket/config/session and waiting epoch authorize a claim.

Files: claim-whatsapp-conversation.use-case.ts; existing whatsapp-handoff-state.ts with a dedicated whatsapp-handoff-claim.spec.ts; SupportController and SupportModule; generic update-support-ticket-status.use-case.ts for WhatsApp in_progress refusal; shared-types audit metadata branch; actual-auth operator fixture and whatsapp-operator-claim.integration.spec.mjs; this feature's status/evidence.

Success: real AppModule/auth/tenant/SQL prove two different operators have exactly one winner, exact binding/ticket assignment, immutable checkout/session, audit plus outbox atomicity and rollback. Same operator may replay only original/current epoch without another write/event. No human authority from an API key, widget, free payload actor or foreign tenant. Closed/merged cases cannot revive. Generic WhatsApp in_progress cannot bypass claim; generic widget update still works. Unit transition10 plus affected existing support/domain/controller tests, one official checked build and dedicated HTTP/DB gate with0skip. Phase-wide Build remains at55. No provider or remote action.

Order: tenant-scoped lookup gives only the lock scope; canonical identity/session lock precedes support-resource lock. Re-read all canonical facts, then CAS binding and ticket before audit/outbox in that same transaction. Existing APIs never obtain a buyer-wide ticket fallback. Any routine fixture compatibility fix preserves existing assertions.

T51 is committed ed75cbd6a757af7704b6c2fec7a65fd74ffdeea3. Root owns the heavy slot; this task starts with source/unit only. Prepared files are SHA-verified; final runtime/types gates remain pending, not inferred from preparation.

## First native classification

Official checked2529 passed, inputbddc8a29d520c8fd025b14f1d4c13aed8c6f7fa3ddcb73f03db800b0158f56b8/artifact490a06ab9fb98e6a5403b520ab3816a3150b8f19c910c1f6e5604860c406f746. Unit31 passed. First native10 executed8pass/2fail (one new child plus parent), natural cleanup0: the new invalid-input loop mixed a foreign tenant field with ordinary extra DTO fields and expected400 for both. Existing TenantGuard source explicitly rejects a foreign body merchantId with403 tenant_mismatch_body, before the claim command; production authorization worked.

Preparation now separates the layers: the loop still expects400 for all original invalid DTO shapes, using the authenticated tenant in the extra merchantId field; the original foreign payload has a separate403 plus exact guard-error assertion. Both remain inside the same exact-state/no-write proof. No old assertion, production source or business expectation changed; no broad status-set assertion. Native-only retry uses the same checked artifact. First log .cache/t52-gates/2026-11-16T03-11-31.572Z/native.log is preserved.

## Approved correction and completed local gate

Parent clarified the TLC rule before acceptance: even the newly authored foreign-body error expectation required explicit user approval. The pre-approval changed run was classified diagnostic only, the real test was restored byte-for-byte, and an external test-module-only overlay separately proved10/10 with original real SHA unchanged. No AppModule/auth/repository or production guard was overridden. Source guard tenant.guard.ts:54 remained intact.

User then approved exactly "Sim, corrigir esse teste para 403 (recomendado)" (call_ef8af0f77f6746789f47388d26a49fd9). Applied only the reviewed candidate SHA dcef33d068a0f44e76400b0af385d63e9865366e477c94b0565848b0f65d2101. The new REAL native gate passed10/10,0skip/provider/owned cleanup, ACK and natural exit0. Log .cache/t52-gates/2026-11-16T03-24-48.775Z/native.log. The diagnostic runs are never counted as this gate.

Together with31/31 selected units and official checked2529/inputbddc8a29/artifact490a06ab, Full52 is green. Source TS remained frozen throughout the correction and native retries. The route/provider, canonical identity-to-support CAS, ticket assignment, audit/outbox and widget preservation are in one task. No message was sent to a provider. The heavy slot was returned before this metadata/commit. T53 operator sends, T56 close/resume and final integrated verification remain pending.
