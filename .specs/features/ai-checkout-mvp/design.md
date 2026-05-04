# AI Checkout MVP Design

## Architecture

The MVP is implemented as a Clean Architecture modular monolith. The `checkout` context owns the vertical flow from session start to dashboard analytics.

## Flow

1. `StartCheckoutUseCase` creates session and global buyer identity.
2. `TrackCheckoutEventUseCase` records checkout events and updates abandonment score.
3. `GetDecisionUseCase` returns whether the widget should open.
4. `SendChatMessageUseCase` authorizes a deterministic offer first, then asks the conversation engine to phrase the response.
5. `EvaluateShippingUseCase` evaluates shipping-specific offers.
6. `ApplyOfferUseCase` calls the commerce adapter and records offer acceptance.
7. Dashboard use cases read scoped merchant analytics and rules.

## Ports

- `CheckoutRepository`: sessions, events, offers, rules, overview.
- `CommerceOfferPort`: apply authorized commerce offers.
- `ConversationPort`: generate buyer-facing messages.

## Persistence

MVP uses `InMemoryCheckoutRepository`. PostgreSQL must replace it through the same port.
