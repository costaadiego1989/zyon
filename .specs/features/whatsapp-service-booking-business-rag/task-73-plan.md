# T73 typed service administration client

The user selected local code and smaller tests. Root recorded the technical dependency correction before dispatch: T73 depends on implemented T25 and T59, while RAG evaluation T72 remains required before final acceptance. No service booking operation is added before its actual T41 HTTP contract.

## Assumptions and exact contracts

The authenticated MerchantProfile supplies id and user_id. Capture that scope once in api.serviceAttendance(profile); individual operations accept resource IDs, never a merchant, operator or connection token. The HTTP guards remain authoritative for role, company mode, ownership and concurrency. This transport does not replace T59 or grant management to Staff.

Use dashboardJson and its existing cookie/bearer session, versioned URL, JSON, idempotency and 401 refresh behavior. Mutations accept an optional stable Idempotency-Key for an explicit replay; do not automatically retry conflict, network or unknown mutation outcomes. Error classification preserves the actual DashboardHttpError and response body. Do not recalculate availability, price, balances, category capacity or booking state.

Controller inventory: service-professionals GET/POST/PATCH/:id and POST/:id/deactivate; eligible GET with productId/variantId/limit/cursor; professional availability GET/PUT and exception POST/PATCH with the professional expectedVersion; service-availability dates/slots GET with the exact server query and status ready/empty/stale; policy GET/PUT at merchants/me/service-business-policy with configured/unconfigured/invalid and version zero allowed for initial configuration. Categories use the existing catalog routes, camelCase write fields accepted by the controller, snake_case DTO fields actually returned, and no invented merchant_id in a category response. Existing catalog functions and their tests stay unchanged.

## Bounded files

Productive files: apps/dashboard/src/api/endpoints/service-attendance.ts (types and scoped group), apps/dashboard/src/api/index.ts (group composition and exports). Tests: new src/api/endpoints/service-attendance.spec.ts. Metadata: this plan, task-73-evidence.json, task/spec progress and own STATE handoff. No backend, schema, package, lock, permission policy, UI route, CSS or T105 source changes.

## Criterion tests before implementation

Assert exact requests and server DTOs for professional pagination/create/edit/deactivate/link replacement; eligible public professional facts; recurring rows and paginated exceptions; one-off/block creation/edit; dates and slots including empty/stale; configured and unconfigured policy CAS; category list/create/edit/delete/reorder. Assert field whitelisting excludes runtime-added tenant/operator/price/token authority, IDs and cursors are encoded, profile scope is captured, missing profile denies before HTTP, no invented appointments surface exists, 400/403/404/409/429/5xx/network/parse failures remain failures, and mutation retries preserve the stable idempotency key only through existing authenticated 401 refresh. Preserve category link IDs and expectedVersion exactly; no client-side success fabrication.

Quick UI gate is unfiltered new service-attendance.spec.ts plus unchanged http/client.spec.ts, http/session-fetch.spec.ts and endpoints/catalog.spec.ts (10 existing cases). Freeze source hashes and case inventory, then execute one existing 1024 MiB admission with one worker and no file parallelism. Actual runner count decides the result; zero skipped. No types/build/browser/memory prompt is requested or authorized by this smaller-test step. Mark T73 only after actual QuickUI green, then create its focused local commit. Phase and feature gates remain pending.

T105 eight WIP files/6264 original/3638 cache candidate/93 prior proof, T107 d949 and six actual reviewed captures, T59 committed permissions, and T56/T106 source-only caches remain preserved and separate.
