# WhatsApp Human Delivery Execution

## T48

Assumptions: the authenticated channel configuration and exact WhatsApp session identify the conversation. Assistance mode and epoch are independent of session lifecycle. The session routing lock and handoff lock must serialize on the same merchant/phone/device identity before expiry or checkout creation. An ordinary AI session retains its existing expiry behavior.

Files: channel handoff state and repository with companion tests; minimal handoff module registration; session port/repository and routing use case for the shared routing lock; owned DB integration and actual AppModule construction/health evidence; task metadata. Existing assertions remain unchanged.

Success: durable scope and epoch CAS, exact ticket ownership, duplicate/restart behavior, stale and foreign rejection with rollback, and controlled renewal/takeover races preserve checkout/context without an orphan checkout. No new artificial HTTP route is created for a persistence component. Actual webhook handoff integration belongs to T49/T50 and retains its Full HTTP/DB gate.

Preparation source: root's pure kernel is a reviewed starting point only. Its prior unit result is not task completion. Booking drafts were moved by identity-preserving moves into `.cache/service-booking-transfer-20261115/originals`; the separate manifest inventories all five originals and forty future draft files and was sent to the receiving author.

Result: unit13/13 including the unchanged eight session-anchor tests; native8/8, zero failed/skipped, checked API build exit0 and compiler coverage2507 sources. Actual AppModule health/ready, PostgreSQL/middleware, controlled advisory-lock contention, close ACK/natural exit0 and owned cleanup passed. Products and services both retain the original checkout/context during human mode; ordinary AI expiry retains its existing new-checkout behavior and advances the epoch. No real provider calls.

The first native run stopped in the new seed before its subcases because CheckoutSession requires explicit createdAt/updatedAt. Corrected only those fixture fields, preserving all assertions and the same checked source artifact. The repeated native run passed. The first attempted lightweight unit launch was refused by its RAM precondition; no test result was claimed for that attempt. Gate paths were aligned to the actual MJS native companion without creating a production test route or reducing later HTTP intake checks.

## T49

Assumptions: WhatsApp authority comes from the authenticated durable inbox/config/session, including typed voice scope, never a source flag supplied by a buyer or model. Widget behavior and its separate history remain intact. Both business modes can request a person. A ticket/binding/message/outbox transaction precedes the confirmation; retries reuse that exact conversation.

Files: existing SupportHandoffService and its minimal support/module/shared-type composition; explicit WhatsApp intake helper and internal turn context; channel request detection and minimal incoming/Meta integration; new dedicated unit and signed HTTP/DB companions. The local runtime adds a reversible child-only provider fixture, replacing the exact sender DI token (and an explicitly identified media interpreter for synthetic voice) before constructing the full AppModule. No fetch patch, production flag, auth/repository override or remote provider.

Success: text/button/authorized voice at checkout, same/other conversation and tenant boundaries, repeat/restart and actual related-write rollback preserve commerce. The signed HTTP webhook, production inbox worker and persisted outcomes are exercised against owned SQL; local submissions/transcripts are labeled synthetic and distinct from real delivery/read. Existing support and media-origin assertions remain unchanged.

Progress: final unit125/125 passed after the authorized transcript/post-sale composition. Initial checked build reported two real type diagnostics (response source union and appointment buyer field). Fixed the response DTO only and used the canonical buyerGlobalUserId; the second checked build exited0 with2510 covered sources. Artifact inputSHA db66ff43591beb3a0c344467dbd8e7fc204517a3a7bd09e3e4e64349c55f484c, artifactSHA3d1dbde19743bbd85c9712b606f7c868bf5cc04839db3fd17c11c3ae5d5b15c1.

Native attempt in `.cache/t49-gates/2026-11-15T14-09-31.895Z/native.log` is not acceptance: T48 passed8/8; default T2 failed its Redis physical capture with the underlying cause suppressed by the existing diagnostic; T49 had9/11 successful subcases and two replay fixture failures. The replay helper regenerated timestamps for the same eventId, correctly causing409. It now preserves the original payload, keeps the200 idempotent expectations and adds explicit409 coverage for an altered payload. Diagnostics now retain a bounded safe cause without changing capture/ownership/budgets. Only the failed T2/T49 runners remain to repeat on the same checked artifact, after the heavy-slot/RAM window. Source is unchanged since the valid build; no new build is required for those MJS-only corrections.

Final result: `.cache/t49-native-retry/2026-11-15T14-26-46.082Z/native.log` passes19/19 (defaultT2=7, signed HTTP/DB T49=12), zero failed/skipped, same checked source/output hashes before and after. T48regression8/8 remains valid on this same artifact. Actual AppModule, real webhook HMAC/auth, inbox/worker, SQL/middleware, NPS transcript consumption, canonical appointment-reference refusal and actual outbox rollback pass; close ACK/natural exit0 and owned cleanup pass. The initial physical-capture cause remains unknown, rather than being attributed to host pressure without proof. No budget or ownership assertion changed.

Sender/media DI overrides are explicit child fixtures, restored after constructing the full AppModule. Notification transport uses a different Symbol and is untouched. Local queued submissions are asserted separately; no real Meta delivery, read receipt, media fetch or transcription is proved. T50 incoming human routing and T51 AI/tool/dispatch fences remain pending.
