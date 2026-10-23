# Owned continuations

Release92: validate the memoized owner's generation before acquiring an init
token. Capture the cart ID at send admission and recheck after initialization
and access preparation, before projection or dispatch. Preserve same-cart
revision handling and canonical empty-to-own-conversation adoption.

The hook maintains an immutable scope identity per merchant generation plus a
mounted flag. Conversation replacement invalidates the generation; adoption of
the operation's first created identity does not invalidate that operation.
Initialization/send references hold owner tokens, so old finally blocks cannot
clear newer work. Restore runs per merchant and persistence cannot copy the old
merchant transcript into the new merchant's storage. Unmount invalidates scope.

The handler receives isCurrent() and applyCartProjection(blocks). It checks scope
after each await, before side effects and inside functional state updaters.
Initialization guards adoption and the separate asynchronous greeting callback.
The hook captures CartProvider.captureConversationCartProjection after
initialization: {merchantId, conversationId, cartId: conversationId}. Public
transport binds cart_id to the signed conversation; the provider captures the
actual current cart/version and denies if its cart differs from that identity.
The generic provider capability also supports a separate expected identity but
this hook must not treat that as permission on the public endpoint.
No unguarded updateFromBlocks fallback is permitted. Projection acceptance is
evaluated once before processing financial callbacks, never after applying its
own cart_summary. Transcript checks only conversation scope.

Existing response contracts use optional legacy conversation_id for ordinary
text; this change does not introduce a mandatory response ID or retry.
API transport hardcodes cart_id to conversationId because controller line208
rejects a different cart_id. No transport or authorization change is made here.

## Nudge continuation coordination

conversation-nudge.handlers.ts handleFireNudge currently receives raw setters.
Its six-second fallback timer and generateNudge then/catch call reveal(), which
writes loading/messages without the merchant/conversation/mounted generation.
It can therefore reveal a stale ephemeral message or clear a newer send's busy
state. It has no cart financial projection. Root authorized bounded completion:
hook passes an isCurrent capability with mounted/scope/conversation plus a
distinct nudge token. A new send invalidates it permanently (including after
send finally goes idle), as does another nudge, merchant replacement or unmount.
Root owns the handler guards and tests for success/error/timer/functional updates.
Only an admitted nudge publishes a new token via onAdmitted. Before admission,
the predicate checks the captured previous token; a manual-only/cooldown/no-text
refusal must not revoke a previous admitted pending nudge and strand loading.
# Channel re-entry implementation — 2026-10-22

Use the existing selectChannel action and a functional messages updater. Keep
nonempty current messages untouched; only build the existing greeting for an
empty transcript. Existing tenant-generation clearing and async guards remain.

