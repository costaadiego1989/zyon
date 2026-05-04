# Commerce Sync Design

## Boundary

`commerce` owns provider-specific product/cart/order synchronization. It exposes provider-neutral ports to checkout and payment workflows.

## Ports

- `CommerceCartPort`: load/validate trusted cart snapshot.
- `CommerceOrderPort`: create pending order, update paid order, cancel/expire pending order.
- `CommerceOfferPort`: apply or translate authorized offer into commerce-compatible discount metadata.

## Flow

1. Secure embed token references a commerce cart/session or trusted server-side cart.
2. Checkout asks `CommerceCartPort` for a trusted cart snapshot.
3. Payment intent uses the trusted payable amount.
4. Commerce pending order is created before or during payment intent creation.
5. Payment approved triggers commerce paid update.
6. Payment failed leaves pending order open, cancelled, or retryable depending on provider policy.

## Provider Strategy

Shopify is first. WooCommerce follows the same ports later. Mercado Pago is a payment provider candidate, not a commerce adapter unless used for marketplace commerce integration.
