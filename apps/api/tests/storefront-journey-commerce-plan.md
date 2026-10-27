# Public storefront commerce journey: execution plan

Status: planning only, 2026-10-20, current sandbox integration. No runtime, runner,
fixture, environment or database changed and no process executed for this plan.
Goal: prove the existing public storefront -> NORMAL embed checkout journey with
the real AppModule/controllers/Prisma/outbox. Do not enable or seed the experimental
`_widgetCrossSellAcceptance` / `widgetCheckoutAuthority` protocol.

## 1. Existing runner and evidence boundaries

- `storefront-journey-bootstrap.integration.mjs`: owns fresh loopback PostgreSQL
  and Redis, marker verification, complete current Prisma schema, artifact
  freshness inventory and bounded child cleanup. Existing exact flags:
  `--local-disposable --prisma-loopback-exec --compiled-test-artifact
  --bootstrap-only --no-real-provider`.
- `storefront-journey-bootstrap.worker.mjs`: real AppModule lifecycle/listener,
  canonical BuyerJwtService and RealtimeCapabilityService, real HTTP conversation
  creation and actual SQL/Redis run/principal binding. No repository/auth override.
- `storefront-journey-bootstrap.seed.mjs`: merchant/rules, buyer, two real products
  with dimensions/stock and own-delivery flat 700 cents. Product 2 has required
  `size:large` option adding 500 cents. Currently no payment connection or approval.
- `storefront-journey-http-operations.mjs`: one-use operation bridge applies ONLY
  to POST storefront conversation messages. Stages are turn/tool/classifier/copy/
  nudge. It does not authorize checkout or PSP calls. Nonmessage HTTP routes can
  use the owned listener and actual route guards, not the LLM bridge as a bypass.
- `storefront-journey-transport.mjs`, `...-guards.mjs`, `...-egress.mjs`,
  `...-original-budget.mjs` and `...-sandbox-llm-budget.mjs` preserve original LLM
  budget and canonical identity. Bootstrap must consume zero calls; any natural
  language journey must debit actual attempted calls, including classifier/copy.
- `storefront-cross-sell-quote.native-worker.mjs` and source/browser fixtures are
  supplemental authority/UI evidence, not a replacement for these HTTP routes.

Do NOT run commerce/payment under `--bootstrap-only` or weaken its zero-provider
fence. Follow-up runner mode/ownership/egress changes require root review first.
Every phase retains marker checks, current compiled artifacts, bounded deadlines,
no dotenv discovery, no retries of unknown writes and full cleanup evidence.

### Three explicit evidence levels

1. Owned commerce HTTP: real controllers/DB; flat shipping and authenticated
   returning buyer; no LLM/email/geocoding/PSP. Seeded cart is NOT proof of public
   add-product behavior. Missing-payment-connection negative test is valid here.
2. Owned payment HTTP: real RoutingPaymentAdapter/AsaasPaymentAdapter against a
   separate synthetic loopback PSP server, active test connection encrypted with
   the existing payment-secret mechanism; real webhook controller authentication.
   No DI override or E2eTestPaymentProvider. This requires a separate reviewed
   exact listener/route/port egress fence; existing bootstrap does not permit it.
   It proves local protocol/application persistence, NOT real PSP acceptance.
3. Actual sandbox: real authorized LLM, configured geocoder/carriers and PSP test
   account; real provider event delivery. Separate explicit provider/budget gate,
   original approval accounting, no production writes. A hand-built Asaas event
   with the configured token is authenticated synthetic input, not a signed
   Stripe event or evidence that the external PSP delivered anything.

## 2. Minimal synthetic fixtures and exact arithmetic

Use distinct conversations/carts/checkouts for each scenario; do not reuse a paid
or bound cart. IDs are returned by the canonical services/DB fixtures, not inferred
from names, SKU, array order or checkout ID.

- Existing merchant/rules: ceiling20%, null product cost, margin-independent.
  Disable unrelated automatic discounts/progressive stages with validated
  CheckoutSettingsEntity defaults (`progressiveDiscount.enabled=false`, no
  advanced rules); isolate coupon tests separately. No strategy/marketplace seed.
- Buyer: extend the synthetic existing account with fictitious fullName, CPF,
  phone and complete address (01310000, street/number/neighborhood/city/SP).
  Use the real app BuyerJwtService signer as bootstrap already does; identity
  hydration must come from the account, not body `email_verified`/buyer flags.
  Complete stored address is returning-profile fixture, not a geocoder proof.
- Trigger variant A: 5000 cents, quantity1, stock100, real dimensions.
- Target variant B: base5000 + canonical selected option `large`500 = 5500 cents.
  CrossSellPromotion row: this merchant, active, startsAt before run, endsAt after
  run, trigger `{sku_in_cart:[A.sku]}`, recommendedSkus `[B.sku]`, discountPercent10,
  maxDiscountPercent10, explicit current updatedAt. No ProductPromotion/coupon for
  the first journey. Never preseed accepted intent/receipt, journal or order.
- Flat shipping700, freeAboveCents=null, merchant free-shipping/subsidy disabled.
- Fee: assert existing `readBuyerServiceFeeCents()` configuration at runtime; with
  current default99, expected numbers below. Merchant transaction fee is not an
  extra buyer fee. Do not change env to force an expected test result.

| Scenario | Base merchandise B | P | D | Effective merchandise | Shipping | Order total | Charged with buyer fee99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary canonical cart A, no intent | 5000 | 0 | 0 | 5000 | 700 | 5700 | 5799 |
| Cross-sell A+B+large at10% on B+option | 10500 | 550 | 0 | 9950 | 700 | 10650 | 10749 |

These percentages are synthetic fixture values, not merchant production policy.
Assert integer cents; UI major units only at the API boundary.

Legacy compatibility is a THIRD scenario, not synonymous with ordinary no-intent
cart: seed exactly the old writer's reduced B unitPrice4950 plus selectedOptions,
without intent/original provenance. Current canonical authority can reject this
shape. Record the honest HTTP outcome as a compatibility RED; do not backfill a
fake accepted intent or assert it is a normal full-price line to pass the test.

## 3. HTTP route sequence, headers and assertions

Let `O` be the owned API origin, `M` merchant, `C` returned conversation/cart ID,
`CT` returned conversation capability, `BT` real buyer JWT, `ET` issued embed
token and `S` checkout session ID read from the token/POST start response.
All paths below use the existing `/v1` middleware prefix.

### 3.1 Conversation and initial cart

POST `/v1/storefront/conversations`

- Headers: `Origin: O`, `Content-Type: application/json`.
- Body: `{merchant_id:M,buyer_access_token:BT}`.
- Assert201, merchant_id=M, actual returned conversation_id=C and valid CT binding
  merchant/resource/origin/aiUserId. C is the storefront cart reference, NOT S.
- Controller-only phase: seed initial A line into C with exact canonical product,
  variant, SKU, 5000 cents, quantity1, future expiry, discount0/freeShippingfalse/
  couponCodenull; record that this bypasses PUBLIC ADD in this phase only.
- Actual interaction phase: use POST
  `/v1/storefront/conversations/C/messages`, headers `Authorization: Bearer CT`,
  `X-Buyer-Authorization: Bearer BT`, `Origin: O`, JSON body
  `{user_message:"...",cart_id:C}` and existing one-use journey slot. Search,
  detail, add and correction are assertions against current tool results and
  subsequent DB/GET, not assumptions based on LLM prose. Public ui_action is
  read-only: never use it to bypass add/write authorization.

### 3.2 Existing cross-sell quote/accept and canonical GET

Headers for storefront requests: `Authorization: Bearer CT`, `Origin: O`, JSON
content type for bodies. Buyer header may be carried but does not replace CT.

1. POST `/v1/storefront/M/cart/C/cross-sell/quote`, body
   `{variantId:B.variantId,promotionId:promotion.id,quantity:1,selectedOptionItemIds:["large"]}`.
   Assert201, scope=M/C, original5500, maximum4950, exact selected option snapshot,
   quote originalSubtotal10500/P550/subtotal9950/merchandise9950, no partial write.
2. POST same prefix `/accept`, body `{expectedQuote:exactReturnedQuote}`.
   Assert201 and strict accepted ACK M/C. Exactly one B+large line; stored base
   unit5500 plus canonical crossSellIntent original5500/maximum4950. Never seed
   or accept `_widgetCrossSellAcceptance`.
3. GET `/v1/storefront/cart/C?merchantId=M`. Assert200, exact variant/option line
   identity, effective B unit49.50, original55.00, A50.00, subtotal99.50,
   total99.50, discount0 (P must not appear again as D), itemCount2.
   Compare DB base vs public projection intentionally; neither is fabricated.
4. Repeat GET and remount read: unchanged prices/options/quantity, no second P.

Negative tests BEFORE accepting: wrong tenant/origin/capability; missing required
option; foreign option; changed promo.updatedAt/option modifier/cart quantity;
forged expected price/coupon/freeShipping. Expect401/403 or409/422 as appropriate,
and byte-identical commercial cart/no intent after refusal. Unknown accept ACK
must lead to GET reconciliation, NEVER retry accept or legacy full-price add.

### 3.3 Public embed issuance and normal bootstrap

POST `/v1/embed-sessions` uses the existing storefront service-to-service route:

- Headers: `X-Internal-Service-Token: runGeneratedInternalSecret`,
  `X-Merchant-Id: M`, JSON. Never expose this header/secret to browser/logs.
- Body: `{allowed_origin:O,cart_ref:C,conversation_token:CT,scopes:["checkout:start",
  "checkout:track","checkout:chat","payment:intents:create",
  "payment:intents:read","payment:intents:confirm"]}`.
- No merchant_id body. Assert201, verify ET through app EmbedTokenService: signed
  storefrontCartRef=C, allowedOrigin=O, real S via embedCheckoutSessionId(claims).
  Existing internal issuer labels environment live; this does not grant real
  payment access. PSP connection environment must independently be test.

POST `/v1/embed/start`, headers `X-AACP-Embed-Token: ET`, `Origin: O`, JSON:

`{session_id:S,buyer_access_token:BT,cart:{items:[],total:0,currency:"BRL",source:"storefront"}}`.

Assert201: S matches token; no new checkout on repeat start; global_user_id matches
buyer account; email_verified comes from JWT/account; no email send. Cart scope
cart_ref=C, selected option snapshots unchanged; experience subtotal99.50,
discount0, item original/effective correct and no private receipt/binding/OTP in
response. For ordinary A scenario assert50.00. Client-supplied fake total/items,
buyer ID, verification or merchant fields must not replace canonical data.

POST `/v1/embed/customer/update` with same embed/origin, body
`{session_id:S,customer:{fullName:"Comprador sintetico",email:account.email,cpf:syntheticCpf,phone:syntheticPhone}}`.
Assert201 `{ok:true}`; same-email proof retained, cart/options/prices unchanged;
repeat start/read unchanged. Email-change proof invalidation belongs to a
separate unattempted session case, not the paying returning-buyer fixture.

`POST /embed/customer/address` is MARKETPLACE-only today; do not pretend it proves
normal checkout address editing. Returning-address bootstrap can exercise flat
shipping with no external lookup. New/changed address must use existing checkout
chat and real existing confirmation/lookup flow in its separate interaction gate.

### 3.4 Selectable normal shipping, not the chat reference

POST `/v1/embed/shipping/quote`, embed/origin headers, body
`{session_id:S,destination_zip:"01310000"}`. Assert201, one configured
`own_delivery_flat` option price700, eta2, is_freefalse, actual ShippingQuote row
merchant/session/CEP. No PAC/Sedex/formula estimate; no carrier provider calls.

POST `/v1/embed/shipping/select`, body
`{session_id:S,carrier_key:"own_delivery_flat"}`. Assert201, shipping.customerPrice7,
selected quote/session destination exact. Normal select may commit quote before
session save: if failure is injected, observe both stores; do not call partial
persist a successful checkout selection or automatically repeat the command.

Repeat normal start/read: merchandise99.50, shipping7, discount0, total106.50,
service_fee0.99, total_to_pay107.49. No benefit should be lost by contact or read.

Additional existing public-mode gates: neighborhood requires matching canonical
CEP/neighborhood; body district cannot donate another tariff. Radius requires
actual permitted geocoding evidence; carriers require real merchant account and
dimensions. Those are not covered by the zero-network flat scenario and cannot
be called passed because private native radius/select tests passed.

### 3.5 Real application payment and synthetic authenticated event

FIRST without any connection: POST `/v1/embed/payment/intents`, embed/origin, body
`{session_id:S,idempotency_key:uniqueRunKey,method:"pix"}`. Assert no provider I/O,
no charge/order and stable not-configured refusal; do not assert an arbitrary
status/message until current routing branch is observed. This is a negative gate.

POSITIVE requires separate owned-PSP mode approval/implementation:

- Preserve real PaymentModule and RoutingPaymentAdapter. Seed/save active Asaas
  merchant connection environment=test via real PrismaPaymentPlatformRepository
  and its payment-secret cipher; no fake repository, preapproved journal or
  E2E_SEED_ENABLED. Use fresh generated synthetic apiKey/webhookToken only.
- Owned Asaas origin pinned via existing ASAAS_BASE_URL_SANDBOX; production URLs,
  redirects, other hosts/ports and unsupported routes fail closed. Configure
  platform fee/wallet semantics using actual adapter requirements, not a fallback
  that removes service fees. Bootstrap's provider fence remains untouched.
- Synthetic server implements only adapter-observed `/v3/customers`,
  `/v3/payments`, `/v3/payments/:id/pixQrCode`, scoped status/read and
  externalReference recovery. Validate request apiKey, customer, method, cents,
  externalReference and split; counters distinguish create vs recovery.
- Actual POST payment-intents as above: assert one journal, amount10749,
  amountBreakdown items9950/shipping700/discount0/platformFee99/BRL, actual provider
  request value107.49, externalReference=actual intent ID; no widget authority.
- Repeating SAME key/request returns SAME ID, SAME frozen amount/provider ID and
  no second PSP create. Different method/body with same key refuses. After send
  ambiguity, recovery uses original journal; no new key/create. Inject lost
  response only in this reviewed mode and count exact actual network operations.

POST `/v1/webhooks/asaas`, headers `asaas-access-token: runWebhookSecret`, JSON:

`{id:uniqueEventId,event:"PAYMENT_RECEIVED",payment:{id:actualProviderPaymentId,
externalReference:actualIntentId,status:"RECEIVED",value:107.49}}`.

Assert200 and processed outcome; wrong/missing token401 and no mutation.
Asaas token auth is NOT a cryptographic signed event. For Stripe use its actual
rawBody/signature controller contract in a separate provider-specific gate.

Poll only bounded existing status/DB evidence; never synthesize state for polling.
GET `/v1/embed/payment/intents/INTENT/status?session_id=S`, embed/origin, assert
200 and actual approved journal. Independently prove one CompletedOrder M/S/
provider external ID/orderTotal106.50, frozen B+large line49.50 and shipping700;
buyer fee is excluded from order total. Approval response alone is insufficient.
Assert one `order_completed` checkout event and one canonical `order.completed`
outbox effect, quota once, original buyer scope and fulfillment snapshot exact.
Observe actual registered stock subscriber/durable outbox processing and bounded
inventory delta; an inventory_sale JSON payload alone is not stock-write proof.
Repeat/concurrently redeliver same event and equivalent approval event: no second
order/quota/stock decrement. Suppress external email/WhatsApp delivery by absence
of configured real destinations/providers; journaled intent is not delivery proof.

## 4. Recovery and remount: separate unpaid scenarios

Generate link using the app's real GenerateRecoveryLinkUseCase on the existing
unpaid M/S (no public generator endpoint exists). Extract its token, not a manual
HMAC. Set child-only PUBLIC_STOREFRONT_URL=O before generation so origin matches.
This is setup of a recovery link; public resume/bootstrap must still run HTTP.

POST `/v1/storefront/merchant.storeSlug/recovery`, Origin O, JSON
`{token:recoveryToken,buyer_access_token:BT}`. Assert201, no-store/no-referrer,
returned embed capability binds recoveredCheckoutSessionId=ORIGINAL S. Use it in
POST embed/start with ORIGINAL S and BT. Assert same buyer, selection/quantity,
effective price and P+D; source cart C is never inferred from S. Current recovered
bootstrap intentionally refreshes current catalog and clears shipping, so with
UNCHANGED catalog assert the exact previous merchandise99.50 and require fresh
shipping selection. Changed catalog/promotion/intent must surface explicit review,
not silently restore an expired discount or charge higher than accepted maximum.

Repeat for ordinary no-intent cart and separately characterize legacy reduced
cart incompatibility. Missing buyer token401, wrong buyer/slug/origin403, expired
link401, approved journal/order410. A paid checkout must NOT be resumed through
abandoned-cart recovery; use same actual payment status/journal, not a new charge.
Current `/embed/payment/current`, action restoration and continuation are
marketplace-specific; do not claim them as generic frozen normal-checkout proof.

## 5. Required execution report

Record source/artifact revision, DB/Redis/listener ownership, scenario seed IDs
(no tokens/PII), each actual route/status, integer amount assertions, before/after
row counts and create/recover counters. Distinguish seeded cart vs public add,
synthetic loopback PSP vs actual sandbox, authenticated Asaas simulation vs actual
provider delivery, journal/order/outbox vs stock/delivery effects. Stop on first
failed invariant; no schema trimming, new authority flags or permissive mocks.

Root must assign runner/seed ownership and authorize serialized execution before
implementation. This markdown does not add capabilities, extend budgets or claim
that the above journey currently passes.
