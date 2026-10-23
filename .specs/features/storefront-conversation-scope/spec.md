# Storefront conversation scope52

Chat continuations belong to the mounted merchant and conversation generation.
Late initialization, greeting, successful turn, error and finalizer must not write
into another tenant/conversation or release another operation's singleflight.
No retry, new conversation on uncertain POST, layout or business-policy change.

Transcript validity is independent from cart freshness. A legitimate reply keeps
its text/history after its own cart_summary, or after another cart writer wins.
Only financial blocks (cart_summary, checkout_prepared, cross_sell) and their
callbacks are suppressed when the captured cart projection is no longer valid.
Missing projection capability fails closed for financial projection only.

Preserve legacy replies without conversation_id; existing typed suggestion
identity checks remain unchanged. The PUBLIC controller binds cart_id to the
authorized conversationId. Capture that request identity while the provider
captures the actual latest cart/version; a divergent cart denies financial
projection without discarding legitimate text. Internal use-case flexibility
does not authorize a separate cart on the public endpoint.

Evidence is deterministic source execution with deferred synthetic IO, not a
browser, server rollback, API authorization, real LLM or payment proof.

## Integrated release regression92

A buyer turn waiting for initialization/access must not migrate to a different
cart introduced during that wait. Abort before dispatch without replay/reset.
StrictMode replay must not register a stale conversation owner's failed promise
as the new generation's initialization. Fresh render may initialize normally.
# Channel re-entry preservation — 2026-10-22

Opening the existing cart/product detail or changing chat/voice must preserve
the active merchant transcript and conversation identity, including a pending
buyer request. Seed the greeting only when that merchant has no messages.
No new layout, API, retry, cart mutation or buyer/merchant boundary relaxation.

