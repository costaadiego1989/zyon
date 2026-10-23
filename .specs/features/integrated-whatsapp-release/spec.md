# Preserve the concurrently released WhatsApp improvements

Integrate commits3858c098 and406cfde9 from the user's WhatsApp session into the
reviewed storefront candidate, without replacing prompts, Zod boundaries,
commercial notices, checkout anchors or current payment/auth configuration.
Preserve consumption reporting, tenant/device session renewal, safe processing
codes, single-result purchase controls and catalog secondary navigation.
Keep the separate Marketplace presentation-only hiding and billing serialization
fix. Do not send WhatsApp messages, charge cards or replay uncertain inbox work.

Sandbox storefront1fdc4529 contains the concurrently restored support UI, absent
from the production100 candidate. Preserve its targeted support/buyer navigation,
authenticated return flow and private binary evidence proxy, but never restore
its older selectChannel transcript reset. No new support design or PSP action.
