# Secure Embed Widget Spec

## Goal

Make the embeddable checkout widget safe for real merchants by moving sensitive checkout data out of the browser. The widget must initialize with a short-lived token and only send events, buyer messages, and buyer actions.

## Requirements

- SEW-REQ-001: The widget must not send cost, margin, merchant rules, provider tokens, commerce credentials, raw email, raw phone, card data, or CVV.
- SEW-REQ-002: Public embed endpoints must authorize through an `embed_session_token`, not a trusted `merchant_id` in the request body.
- SEW-REQ-003: Tokens must be merchant-scoped, session-scoped, expiring, and tamper-evident.
- SEW-REQ-004: Replayed, expired, malformed, or cross-merchant tokens must be rejected.
- SEW-REQ-005: Server-side session creation must resolve the trusted cart snapshot from commerce/session storage, not from browser-supplied price fields.
- SEW-REQ-006: The widget may send checkout interaction events and buyer messages.
- SEW-REQ-007: The widget may request approved actions, such as apply offer or start payment, but deterministic server modules decide whether the action is allowed.
- SEW-REQ-008: Embed API tests must prove request bodies cannot spoof merchant/session identity.

## Public Contract

The production widget should receive only:

```html
<aacp-checkout-agent embed-session-token="emb_..."></aacp-checkout-agent>
```

The token resolves:

- `merchant_id`
- checkout/session id
- optional commerce cart reference
- expiry
- allowed origins

## Non-Goals

- Implementing Shopify OAuth.
- Implementing payment processing.
- Passing full cart line costs or margin into the browser.
