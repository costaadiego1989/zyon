# Direct store charges and provider payouts

Decision, 2026-10-18: for a purchase from one store, its connected provider
owns the payout to the merchant. A provider payout schedule must neither
disable checkout methods nor select the platform account for a new charge.

The store's legacy `paymentRetention` setting and the global
`PAYMENT_MERCHANT_*` payout settings are no longer read by direct checkout
creation. Their presence, absence or malformed historical values cannot
remove Pix, card or crypto from an otherwise configured direct checkout.

| Route | New charge account | Platform fee |
| --- | --- | --- |
| Mercado Pago Pix / hosted card | Merchant OAuth credential | Provider application / marketplace fee |
| Stripe card | Connected account, `direct_v2` | Application fee |
| Asaas Pix / hosted card | Merchant credential | Provider split |
| Crypto | Merchant's configured treasury | Explicit platform fee transfer |

Charging authorization remains authoritative. In particular, Stripe's
`chargesEnabled` is independent of `payoutsEnabled`; pending payout
requirements remain stored for the merchant without disabling approved card
charging. Existing restricted/pending Stripe snapshots with charging enabled
also remain usable. Degraded connections are not treated as ready.

No existing payment is moved between accounts. Idempotent retries read its
saved creation snapshot. Historical retained payments still use their
original platform account for reconciliation, refunds and scheduled payouts.
Marketplace purchases still enter `CreateMarketplacePaymentService` before
the direct checkout path and keep their existing funding/settlement rules.

Regression coverage includes all six provider/method combinations with no
policy, the historical seven-day policy, and invalid legacy policy; disabled
global payout gates; disabled withdrawals with enabled charging; existing
retained intent retries; provider adapters, cancellation, refunds, signed
webhooks and payment recovery. The provider suites use controlled responses;
they do not establish that an external live charge was paid.

Provider contracts consulted:

- [Stripe charging and payout capability](https://docs.stripe.com/connect/handling-api-verification#determine-if-verification-is-needed)
- [Mercado Pago seller OAuth and provider split](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)
- [Asaas charge ownership and split](https://docs.asaas.com/docs/split-de-pagamentos)
