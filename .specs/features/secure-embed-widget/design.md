# Secure Embed Widget Design

## Boundary

The secure embed belongs to the checkout boundary because it controls public checkout session access. It may call commerce/payment ports, but it does not own commerce catalog or payment processing.

## Flow

1. Merchant backend or AACP app creates an embed session token.
2. Widget loads with only `embed_session_token` and API base URL.
3. Widget calls `POST /embed/start`.
4. API validates token and creates/loads the checkout session server-side.
5. Widget sends events through `POST /embed/track`.
6. Widget sends chat through `POST /embed/chat`.
7. Widget starts payment through `POST /embed/payment/start`.

## Token Rules

- Token payload must include merchant id, session id/cart reference, expiry, and nonce.
- Token must be signed server-side.
- Token must not include raw customer PII, cart cost, margin, merchant rules, or provider credentials.
- Token validation is a domain/application concern behind a port; signing implementation is infrastructure.

## Public Endpoints

- `POST /embed-sessions`: protected merchant/server endpoint to create a token.
- `POST /embed/start`: public token endpoint to start/load checkout.
- `POST /embed/track`: public token endpoint for events.
- `POST /embed/chat`: public token endpoint for conversation.
- `POST /embed/offers/apply`: public token endpoint for approved offer application.
- `POST /embed/payment/start`: public token endpoint for payment.

Existing direct checkout endpoints can remain for tests/internal use, but the browser embed must migrate to token endpoints.
