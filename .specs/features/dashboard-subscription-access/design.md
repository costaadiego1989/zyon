# Implementation

Keep requestedTab as navigation identity. A SubscriptionAccessGate consults the
existing subscription route policy before mounting route children. Reuse the
existing EmptyState and Button components. Navigation depends on role/channel,
not subscription status. Keep existing API and role guards and background-task
suspension. Financial recovery remains under its existing module, not a new
top-level menu. Share the approved onboarding plan-card presentation with the
dashboard; keep useBillingPlansPage payment handlers unchanged.

Remove the Marketplace NAV_ITEMS entry for all roles/plans. Keep its TabKey,
page resolver and API intact. Filter the canonical marketplace feature from
commercial plan mapping even when a previous API still returns it; remove its
curated highlight and public pricing copy. Do not alter plan prices, entitlement
flags, marketplace operations or ERP/external-marketplace integrations.
