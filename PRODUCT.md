# Product

## Register

product

## Users

Zyon is a commerce platform. This work concerns its existing Control application, used by platform operators for companies, subscriptions, support and operations. Company prospecting is restricted to platform administrators in this release. Operators search an official company directory, select a segment, review a campaign, follow replies and assume a conversation when necessary.

## Product Purpose

Give operators a reliable place to discover companies and conduct Zyon sales conversations. Each screen supports a concrete task: search, inspect a company, review an audience and budget, read/respond, publish project knowledge or inspect channel readiness. Successful operation preserves company identity, current server offers, command outcomes and the distinction between an attempted message, acceptance, delivery, response and paid subscription.

## Brand Personality

Operational, clear and precise. Preserve the existing Control identity and Portuguese interface vocabulary. Its current light surfaces, restrained green accent, sans-serif typography, compact navigation and data-oriented layout are the reference. This feature does not introduce a new brand or redesign unrelated Control screens.

## Anti-references

Avoid a marketing landing page inside the admin, ornamental metric cards, nested panels, decorative status colors and instructions that expose worker implementation details. Avoid invented availability, delivery, consent, prices or conversion. An unavailable source or unknown command outcome must remain understandable and actionable.

## Design Principles

- Put the operator's next task and the relevant business state first.
- Show readable company, location and segment labels while preserving their authoritative identifiers.
- Keep recipient conversation, internal notes and commercial outcomes understandable in context.
- Open lead editing in a contextual side dialog over the retained list. Brazilian phone presentation uses a DDD mask without visible +55; canonical provider addresses and opaque identities stay unchanged.
- Use consistent controls and feedback throughout the existing app; recover uncertain commands before another mutation.
- Make configuration and eligibility prerequisites visible without implying a real provider interaction from local preview data.

## Accessibility & Inclusion

The approved feature requires labeled controls, keyboard navigation, visible focus, appropriate announcements, focus restoration and real loading/empty/error/denied/stale states. The interface must work at1440,390 and320px. Use readable contrast and reduced-motion alternatives. CNPJ inputs accept letters and preserve leading zeros. Long names, exact monetary values and chat content must remain usable on small screens.

## Sources and Scope

Context is taken from the approved company-prospecting specification/design and the existing Control implementation: apps/control/src/ui/ControlApp.tsx, apps/control/src/ui/SupportInbox.tsx, apps/control/src/styles.css and apps/control/src/lib/api.ts. Existing design tokens are preserved. No binding screen capture or new visual identity was requested.
