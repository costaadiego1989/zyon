# Merchant conversations and marketing

The `MarketingModule` owns contacts, conversations, consent, funnel history,
campaigns and delivery records. Other modules access the stable
`MARKETING_RELATIONSHIP` contract. Read projections remain in the modules that
own buyer identity, checkout, payment, consent and WhatsApp sessions. The
WhatsApp transport resolves each merchant's credentials internally.

## Activation

Apply the five additive SQL migrations in `prisma/deploy-migrations` in order:
`20261127090000_merchant_marketing_crm`,
`20261127091000_marketing_message_order`,
`20261127092000_marketing_lifecycle`,
`20261127093000_marketing_purchase_amount`,
`20261127094000_marketing_unresolved_messages`. They follow the existing deployment
migration mechanism. Generate Prisma after updating the schema. No migration
to a remote database or production activation was performed by the local implementation.

The module uses the current effective Growth/Scale entitlement on every data
request and campaign dispatch. Staff handles conversations and contact stages;
owner/admin approves campaigns and configures communication controls.

Set `MARKETING_CAMPAIGN_WORKER_ENABLED=true` on the process responsible for
campaign dispatch. Set `MARKETING_LIFECYCLE_WORKER_ENABLED=true` for historical
imports and retention. Both default to disabled. Workers use database leases,
row locks and durable send markers; multiple instances do not authorize a
second attempt. Scans run every 15 seconds with bounded batches.

Classification uses the existing configured model provider and AI usage ledger.
Set `MARKETING_AI_CLASSIFICATION_ENABLED=false` to disable classification.
It may classify explicit interest only. Checkout/payment sources establish
shopping, pending payment and confirmed purchases.

## Merchant workflow

Open **Conversas** to filter site/WhatsApp messages, claim a conversation,
respond and finish handoff. The site polls its scoped transcript; a claimed
conversation suppresses AI replies, including responses already generating.
WhatsApp freeform replies require a current service window. Unknown-origin
historical conversations are read-only.

Open **Marketing** for identified contacts, funnel, campaigns and controls.
Site visitors remain anonymous until verified signup/login. A WhatsApp inbound
provides a phone identity; account linking requires a verified phone ownership
record. Display aliases and profile phone fields never prove identity.

The opening promotional choice is optional. Both choices continue service.
An affirmative session choice alone does not enroll an anonymous browser.
`PARAR` revokes WhatsApp marketing permission. Newer global or same-store
revocations block older grants; another store's decision does not block this
store. Recovery and post-sale consult the same consent and frequency boundary.

Configure timezone, sending hours, per-contact frequency and inactive-lead
retention. Campaigns require explicit integer budgets and a merchant estimate
of unit cost. **Reservations enforce this estimate, not the actual Meta
invoice.** Actual provider charges are not inferred. Review includes all
selected contacts and exclusion reasons. Provider template approval and
merchant approval are separate. Editing invalidates prior approval. Only
static text templates are supported in this version; no invented variables,
attachments, email campaigns or journey builder.

**Configurações → Importar histórico disponível** starts a durable paged job.
Repeat imports are idempotent and do not send messages. Historical messages
are marked recorded, not delivered. An unproved origin stays unknown and
unproved historical permission stays absent. Retention removes eligible
inactive relationship content, preserving confirmed purchases, active human
conversations, uncertain sends, campaign audit and hashed opt-out suppression.
It does not delete source records owned by checkout or buyer-account.

## Operations and failure recovery

Observe `marketing_operations_total`, `marketing_operation_duration_seconds`
and `marketing_message_dispatches_total`. Labels contain bounded operation
names/outcomes. Structured `marketing_operation` logs include duration,
correlation and safe reason codes, without customer text or credentials.

`accepted` means a provider identifier was received. Only an authenticated
Meta status webhook advances delivery/read. Template identity, body, language,
category and current WABA must still match before dispatch.

`unknown` holds an uncertain send or expired sending lease. Do not retry it
blindly. Reconcile the provider ID and signed callback before deciding on a new
campaign. An uncertain template submission retains its deterministic name;
**Atualizar situação do template** reads that name rather than creating it again.
Paused campaigns display the reason. Failed imports can be started again;
completed batches remain safe to repeat. Revenue attribution remains absent
until a traceable campaign/order relationship exists.

## Local evidence

The isolated workspace uses PostgreSQL at `127.0.0.1:15447`, databases
`marketing` (module schema) and `marketing_runtime` (complete app schema).
Tests reject non-local database hosts and create/delete only random test
tenants. Browser agent actions reach real Nest authentication and PostgreSQL.
Provider/model calls are fakes; the site browser harness adapts its HTTP routes
to the actual site use cases and real database. It does not prove live Meta
credentials, provider approval, delivery or production deployment.

Four existing broad regression assertions also fail in the private baseline:
three storefront history/focus harness cases and one old WhatsApp webhook
timestamp assertion. An in-memory comparison with the exact `d7a643af` source
reproduced the same failures. Their assertions were preserved; the module
checks do not claim that the entire repository CI is green.

Run the module suite from the workspace root with the existing
`apps/api/tests/platform-support-loader.mjs` loader and the module's
`*.spec.ts` files. `apps/dashboard/tests/build-marketing-local.mjs` builds with
synthetic public OAuth values; never publish that local bundle. Final checks
and the independent review live in the private feature spec directory.

The feature commits are based on a private snapshot `d7a643af` of concurrent
work. Do not publish that snapshot wholesale. Integrate the feature commits
onto the reviewed branch and rerun migrations, build and environment checks
before any separately authorized release.

## Production integration

The release branch starts from production API `63a882f2`. Its dashboard and
storefront trees match the published frontend revisions `668ad4b4` and
`1c622196`. The native Meta inbox remains the authority for media provenance,
response preparation and uncertain sends. Marketing checks ownership again
at each native delivery; a completed or suppressed turn cannot send on replay.

Native WhatsApp contacts use the canonical store conversation before checkout
exists. Cart facts come through the storefront public reader. Historical
native sessions without per-message dates import their proven phone contact,
without inventing message dates or marketing permission. Interpreted attachment
context remains a reference while the buyer answers the opening.

Classification obtains admission from the current AI governance/metering
service before a paid call. Unknown provider usage stays unknown. The facade
uses the existing usage and pricing ledger; it creates no parallel ledger.
