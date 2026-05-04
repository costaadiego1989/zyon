# Payment Asaas Design

## Boundary

`payment` owns buyer payment intents, attempts, provider references, webhooks, and payment facts. It does not own product/catalog/order sync. Commerce modules create/update commerce orders after payment facts.

## Core Flow

1. Checkout session exists.
2. Buyer chooses payment method.
3. `CreatePaymentIntentUseCase` validates checkout session and amount.
4. `PaymentProviderPort` creates the provider payment.
5. Payment intent stores provider reference and safe buyer-facing instructions.
6. Asaas sends webhook.
7. `HandleAsaasWebhookUseCase` records provider event idempotently.
8. Approved payment completes checkout order once and emits `payment.approved`.
9. Failed payment emits `payment.failed` and can trigger payment-friction conversation.

## Ports

- `PaymentRepository`
- `PaymentProviderPort`
- `CheckoutPaymentPort`
- `CommercePaymentSyncPort`

## Asaas Adapter

The Asaas adapter must be infrastructure-only. It may know Asaas URLs, headers, payloads, and env vars. Domain/application may only know provider-neutral DTOs.

## Card Safety

If card is supported in v1, prefer provider tokenization or hosted/transparent flow where AACP stores only provider token/reference. Raw PAN/CVV must not be persisted or logged.
