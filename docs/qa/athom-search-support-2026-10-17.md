# Athom catalog search and human support — 2026-10-17

## Production diagnosis

- Store: `athom-technologies` / `mrc_696a583b-e0b8-4956-aea7-4f15037de32b`.
- Direct catalog inspection found 11 active entries; the available-products search returned 10.
- The live storefront answered “O que vocês vendem?” with an empty-catalog claim and an electronics description despite the active skin-care products.
- The shared contextual search introduced during WhatsApp work retained generic navigation words as mandatory product attributes. “vendem” and “disponíveis” therefore eliminated real catalog matches. The user's exact question was “quais produtos você tem a venda”.
- Three real open tickets shared one conversation, had no buyer identity and no initial messages. Their existence was confirmed in production; their contents were not changed and no operator replies were sent to them.
- The sales handoff omitted the verified buyer ID and created a ticket on every request. The hub did not load human support cases and its notification trigger was hardcoded off.

## Changes

- Generic catalog questions use the existing catalog browse path and real product cards. Actual needs, product names and negative constraints still use contextual filtering.
- Human handoff persists its initial message, buyer identity when authenticated, durable support events and one active ticket per conversation/customer.
- A guest case can be linked after login only with both the private conversation capability and a verified buyer token scoped to the same merchant. Browser/model body fields do not establish ownership.
- Historical duplicate cases can be linked to a canonical case without deleting their messages.
- Buyer Hub loads the existing authenticated support APIs, displays merchant replies, accepts buyer responses and polls for updates. Failed sends reuse an idempotency key.
- The account button and Conversations tab show the number of unread conversations. Opening the hub does not mark messages read; opening the actual conversation acknowledges only the last rendered message. Concurrent later replies remain unread.
- Added only the explicit support-claim route to the existing origin-checked storefront proxy.

## Validation

| Check | Result |
| --- | --- |
| Shared storefront/WhatsApp regression suite | 291 passed, 1 existing skipped test |
| Proxy origin and credential forwarding | 12 passed |
| New support UI, mobile and desktop | 4 passed |
| Existing conversation navigation | 7 passed |
| API production compilation | Passed |
| Storefront production build | Passed |
| Deployed sandbox persistence | 10 checks passed; fixtures removed; no external messages |
| Real sandbox browser, no intercepted responses | Badge 1 → read → 0; merchant reply visible; buyer reply persisted; authenticated claim accepted; mobile without horizontal overflow |
| Deployed production persistence | Same 10 checks passed with isolated QA tenants and cleanup |
| Exact customer question in canonical production storefront | Real catalog cards returned with product IDs, names and prices; no empty-catalog claim |
| Production chat → human handoff | One ticket persisted from the real storefront request, initial buyer message saved, buyer identity linked, found by the dashboard listing use case |
| Production merchant reply → hub → buyer reply | Live APIs without intercepted responses; badge 1 → read → 0; response displayed; buyer reply read back from the persisted case; mobile without overflow |
| Production source identity | 28 file hashes matched, including modified search/support code and the preserved existing financial baseline; 11 active products |

Persistence probe: `apps/api/scripts/validate-support-hub.cjs`. It uses isolated QA tenant identifiers and the deployed services, reads committed data, exercises concurrent requests/ownership/read cursors/alias preservation, then removes its own fixtures.

## Release identity

- API baseline: the active production `6a1308cabbacb7f1c9694a4fdb3fb0be09857cb2`, preserving its existing billing/ERP/financial changes.
- API code archive: `e74fc14`.
- Sandbox API: `505f2128-b024-42fa-bf74-b724742f5eaa`, SUCCESS.
- Sandbox storefront: `c942d940-2301-40a1-8c99-19fd473f9de2`, SUCCESS, UI code `b6bf049`.
- Storefront source: current production master baseline `b7f2524`, with the focused UI patch and tests. API changes are also integrated into master at `3ed84ab`.
- Production API: `92d2bf88-0001-4e82-be6c-07a60b895c1b`, SUCCESS, runtime source hashes verified.
- Canonical production storefront: Vercel `dpl_GavTRaYBtrueahkFFMAfqnP3bDRi`, READY, source `3ed84ab7a40d7d9245f29c35141c949be6ed7ddb`; canonical alias verified through the deployment API.

The production human-support probe used a temporary synthetic buyer account and created its ticket by sending “Quero falar com um atendente humano sobre um produto.” through the actual storefront. The merchant response used the same persisted message use case used by the dashboard; the dashboard browser itself was not used. The hub then fetched and acknowledged that response through live authenticated APIs and sent a buyer response that was read back from storage. The synthetic account and support fixtures were removed after verification. Normal audit/usage records from the chat were retained.

No real payments, transfers, refunds or operator messages to existing customers were performed. Existing customer tickets and carts were preserved. Browser tests use synthetic QA identities, not customer impersonation.
