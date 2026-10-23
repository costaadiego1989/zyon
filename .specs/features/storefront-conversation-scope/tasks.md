# Tasks52

- [x] Release92: rerun the complete scope corpus after owner integration,
      with useMemo/access-proof mocks and scheduled StrictMode rerender.
- [x] Reject a cart identity replaced during pending initialization/access;
      retain late-tenant, singleflight and transcript assertions.

Release93:26/26 scope cases, including access renewal replacement. Composition
with projection/start identity/checkout continuity/cross-sell layout:96/96.
No real network, LLM/payment or React DOM proof in this source scheduler.

- [x] Map initialization, restoration, send, greeting, projection and finalizers.
- [x] Agree CartProvider captured projection capability with root.
- [x] Reproduce deferred stale-scope failures before runtime changes (13 cases,
      2 passed / 11 failed; synthetic source runtime).
- [x] Implement owned init/send lifecycle and guarded handler continuations.
- [x] Verify merchant/unmount/late greeting/error, singleflight ownership,
      legitimate transcript after own cart update, stale financial filtering,
      missing capability and public conversation-bound cart identity.
- [x] Prove deferred React updaters after send finally, stale queued updates,
      StrictMode cleanup/setup with late initializer/greeting and merchant ABA.
- [x] Wire authorized nudge scope/token into the hook; prove new-send/finally ABA,
      new fire, tenant replacement and unmount invalidation. Root owns the
      actual nudge handler timer/success/error/updater corpus.
- [x] Reproduce refused-admission ownership gap:3/3 RED for synthetic
      manual-only/cooldown/missing-fallback refusal, then publish token only
      through onAdmitted and verify25/25 source cases GREEN.
- [x] Root runs integrated typecheck/build/browser gates; no agent heavy gates.

Paused while user freed disk space, then explicitly resumed. Final source corpus
25/25 passed, exit0 (754.7359ms), including refused admission. Composed command
from apps/storefront:

`node --test tests/storefront-conversation-scope.test.cjs tests/storefront-read-actions.test.cjs tests/storefront-suggested-read-actions.test.cjs`

Before the parallel transport hardening:137/137 passed, 0 failed/skipped/cancelled,
duration2962.7161ms. Latest expanded composition139/140 (2891.7026ms): pre-existing
read-actions test at line384 expects mismatched start to succeed, while the
parallel create boundary now throws conversation_start_merchant_mismatch. Root
notified to align this test with the stricter public contract. All25 owned scope
tests are GREEN. Runtime frozen and handed to root. Tool output provides this
local source evidence; no browser,
server authorization, LLM, payment, full compilation or deployment claim.

Root final52 evidence supersedes intermediate composition mismatch above:
legacy test384 now rejects an explicit foreign merchant while retaining absent
merchant legacy compatibility. Persisted command `pnpm test:conversation-scope`
passed171/171,zero skip,6414ms,exit0. Full storefront434/434,zero skip,21086ms;
tsc/Nextbuild exit0. Browser joint9/cart11/direct24/detail12 all passed with
synthetic upstream; none of these fixtures exercises a real LLM chat or payment.
Logs in apps/api/.sandbox-state/storefront-lote52-*.log. No production mutation.
- [x] Reproduce real Athom cart opening transcript loss and2 RED lifecycle tests.
- [x] Preserve transcript on channel/cart/detail re-entry; verify29 scope regressions.
- [x] Deploy storefront100 to sandbox then production and recheck real FAQ/cart UI.

