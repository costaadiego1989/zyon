# T59 independent permission primitives

Root recorded the technical order59->56->57->58->60->61->62 before implementation. T59 depends on completed9canonical company profile and53authenticated support policy, not pending55/58queue. This is local implementation; no route/tab wiring before62, backend authorization change or production action.

## Assumptions and policy evidence

The existing support allowlist admits OWNER/ADMIN/STAFF. Existing whatsapp-seller configuration admits OWNER/ADMIN. Preserve PERMISSIONS, canAccessTab and filterNavByRole byte-for-byte, including their existing unrestricted/pre-session behavior. New sensitive helpers must fail closed for unrecognized/missing canonical roles; they cannot inherit that legacy permissive fallback.

Service management is separately OWNER/ADMIN: ServiceAvailabilityManagementController and professional create/PATCH HTTP decorators require owner/admin, and assertServiceAdministration(write=true) enforces the same roles. Read-only professional/availability endpoints permit staff separately; T59 must not infer service management from support or settle a future staff read-route policy. Name the helper canManageServiceAttendance and the target service-attendance:manage.

Backend resolveServiceBusinessPolicy maps services without a selected classification to review_required. Require canonical services plus selectionState=selected for service management. Missing/unknown/review classification or missing authenticated profile IDs denies that management capability. WhatsApp conversations/configuration retain their current mode-independent role policy. A plan never grants role or service mode; no invented profile capability or paywall field.

## Bounded files

Productive: apps/dashboard/src/lib/auth/permissions.ts only, append three explicit helpers and a whitelist dispatcher. New tests append to permissions.spec.ts while preserving every old test body/assertion. Actual existing permission companion is shell/subscription-route-policy.spec.ts; select it unfiltered and do not edit it. No route, menu, profile transport, API, schema, CSS, config or provider change.

Metadata: this plan, task59evidence, task/spec completion and own STATE checkpoint. Current105WIP,6264original/3638cachecandidate/93proof,107source and sixcaptures,106cache,56cache remain separate.

## Criteria and tests before productive implementation

Role×product/service×all existing profile-plan variants asserts conversation/configuration/management separation and exact whitelist delegation. STAFF conversation allowed but configuration and service writes denied; OWNER/ADMIN management only in selected service context. Missing/invalid roles and profiles fail closed, unknown sensitive target names including prototype-like keys fail closed, classification unknown/review denied, and authenticated product/legacy support behavior remains. No test claims a UI helper replaces authenticated HTTP tenant guards or subscription routing.

The unfiltered existing permissions5 and subscription-route-policy15 cases run alongside every new criterion case. Freeze actual files/source hashes/count inventory before one unchanged1024admitted unit invocation; runner totals are authoritative, zero skips. No types/build/browser/resource probe beyond that unit admission is authorized now. Phase-ending and final same-HEAD proofs remain future gates. Only actual QuickUI green permits marking59 before its focused atomic local commit.
