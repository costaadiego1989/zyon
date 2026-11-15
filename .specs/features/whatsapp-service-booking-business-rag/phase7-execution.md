# WhatsApp Human Delivery Execution

## T48

Assumptions: the authenticated channel configuration and exact WhatsApp session identify the conversation. Assistance mode and epoch are independent of session lifecycle. The session routing lock and handoff lock must serialize on the same merchant/phone/device identity before expiry or checkout creation. An ordinary AI session retains its existing expiry behavior.

Files: channel handoff state and repository with companion tests; minimal handoff module registration; session port/repository and routing use case for the shared routing lock; owned DB integration and actual AppModule construction/health evidence; task metadata. Existing assertions remain unchanged.

Success: durable scope and epoch CAS, exact ticket ownership, duplicate/restart behavior, stale and foreign rejection with rollback, and controlled renewal/takeover races preserve checkout/context without an orphan checkout. No new artificial HTTP route is created for a persistence component. Actual webhook handoff integration belongs to T49/T50 and retains its Full HTTP/DB gate.

Preparation source: root's pure kernel is a reviewed starting point only. Its prior unit result is not task completion. Booking drafts were moved by identity-preserving moves into `.cache/service-booking-transfer-20261115/originals`; the separate manifest inventories all five originals and forty future draft files and was sent to the receiving author.

Result: unit13/13 including the unchanged eight session-anchor tests; native8/8, zero failed/skipped, checked API build exit0 and compiler coverage2507 sources. Actual AppModule health/ready, PostgreSQL/middleware, controlled advisory-lock contention, close ACK/natural exit0 and owned cleanup passed. Products and services both retain the original checkout/context during human mode; ordinary AI expiry retains its existing new-checkout behavior and advances the epoch. No real provider calls.

The first native run stopped in the new seed before its subcases because CheckoutSession requires explicit createdAt/updatedAt. Corrected only those fixture fields, preserving all assertions and the same checked source artifact. The repeated native run passed. The first attempted lightweight unit launch was refused by its RAM precondition; no test result was claimed for that attempt. Gate paths were aligned to the actual MJS native companion without creating a production test route or reducing later HTTP intake checks.
