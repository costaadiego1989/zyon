# T74 service administration state

T73 is committed at53a5cd572 with actual48/48 QuickUI. User selected code and smaller tests. This task implements the hook and its criterion tests; no route, screen, browser/build gate or T41 appointment contract is invented.

## Assumptions and files

Use the existing ApiContext, MerchantProfile and canManageServiceAttendance. A selected service OWNER/ADMIN can load the current professionals page, categories and policy through the scoped T73 client. Product mode, Staff, missing profile and review-required classification do not mount these management requests. Server guards remain authoritative.

Only apps/dashboard/src/pages/service-attendance/useServiceAttendancePage.ts and its new .spec.ts are productive. Metadata is this plan, task74 evidence, scoped task/spec and STATE progress. T73 transport, existing permissions and companions remain unchanged, together with the eight T105 files, frozen T107 and source-only T56/T106.

## State and commands

Keep tab, period, professional and category selectors in the existing hash query convention. Validate the tab whitelist and canonical date pair, preserve unrelated parameters, read hashchange/back and never rewrite another route. These selectors do not manufacture server-side capacity or filter an incomplete page into authoritative counts.

Keep each read and command bound to the current authenticated context. Ref identity updates during render; a changed context immediately masks previous data and denies retained command callbacks before passive cleanup. Latest read wins; unmount, account/mode/role changes and old availability selectors invalidate pending responses. A failed refresh preserves the last actual snapshot with an error, rather than presenting a fabricated empty result.

Commands are explicit wrappers for the existing T73 administration mutations, serialized with a synchronous ref to prevent double gestures before React renders. No public arbitrary callback executes a booking operation. Keep prior server state while saving; publish success only after the actual HTTP result. Conflict/network/JSON error preserves prior data and actual error kind, with no automatic resend or optimistic booking/payment confirmation. A successful write reloads the server snapshot; a reload failure is separate from a successful command. Retained callbacks from a prior account do not act on the new current /me policy. Availability reads retain exact ready/empty/stale and returned dates/slots; they do not confirm a reservation.

## Criterion tests before implementation

Exercise actual hook state through React act with the existing injected HTTP transport: authorized and denied scopes; loading/ready/empty/error; canonical filters and URL/back; latest refresh wins; stale tenant/mode/unmount results; no previous-scope data flash; serial double-submit; deferred save has no optimistic result; conflict/network/invalid JSON retains data and does not resend; old callback cannot mutate a new tenant; successful write plus failed reload; actual mutation payload/version; availability empty/stale and invalidation after selector changes. No existing assertion is edited.

The next QuickUI invocation will be unfiltered hook tests plus unchanged T73/client/session/catalog and permission companions, frozen counts and source hashes, using the existing1024 admission and one worker only after Root hands over the sole execution slot. No extra gate or resource probe runs during source preparation. T74 is not marked before its actual gate. T75-77 browser gates and T72 evaluation remain pending.
