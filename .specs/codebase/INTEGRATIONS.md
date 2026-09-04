# Integrations

## Commerce Platforms

### Integration Strategy

Zyon operates as a **headless checkout overlay** — the widget IS the checkout. Payment is processed through our backend without redirecting the buyer to the platform's native checkout.

Only platforms that allow **programmatic order creation + payment processing via API** are viable. Platforms that force hosted/redirect checkout are excluded.

### Viability Matrix

| Platform | Market Share BR | Headless Checkout | Payment via API | Status |
|---|---|---|---|---|
| **Embed (próprio)** | — | ✅ Total | ✅ Asaas/Stripe | ACTIVE |
| **WooCommerce** | ~15% | ✅ REST API | ✅ Gateway SDK | PLANNED |
| **Magento/Adobe Commerce** | ~8-12% | ✅ REST/GraphQL | ✅ Tokenized nonce | PLANNED |
| **VTEX** | ~3-5% (enterprise) | ✅ PPP | ✅ Card data direct | HOMOLOGATION |
| **Tray Commerce** | ~10% (BR SMB) | ⚠️ Under evaluation | ⚠️ Transparent checkout | EVALUATING |

### Excluded Platforms

| Platform | Reason |
|---|---|
| Shopify | Forces hosted checkout — no way to process payment without redirect |
| Nuvemshop/Tiendanube | Forces hosted checkout — payment only through their UI |
| Loja Integrada | Hosted checkout, no headless API |

---

## WooCommerce

**Type:** Headless REST API

**Flow:**
1. Widget collects cart + payment info
2. Backend tokenizes card via Stripe SDK (PaymentIntent)
3. Backend creates order via `POST /wp-json/wc/v3/orders`
4. Confirms payment via gateway webhook
5. Updates order status to `processing`

**Requirements:**
- WooCommerce REST API credentials (Consumer Key/Secret)
- Stripe or compatible gateway configured on the store
- Store must have REST API enabled

**Environment:**
- `WOOCOMMERCE_STORE_URL`
- `WOOCOMMERCE_CONSUMER_KEY`
- `WOOCOMMERCE_CONSUMER_SECRET`

---

## Magento / Adobe Commerce

**Type:** Headless REST API

**Flow:**
1. `POST /V1/carts/mine` → create cart
2. `POST /V1/carts/mine/items` → add items
3. `POST /V1/carts/mine/shipping-information` → set shipping/billing
4. `POST /V1/carts/mine/payment-information` → process payment + create order

**Payment mechanism:**
- Widget runs Braintree JS SDK or Stripe.js client-side
- Generates `payment_method_nonce` (tokenized card)
- Backend sends nonce via `additional_data` to Magento
- Magento processes payment internally via configured gateway
- Returns `orderID` — zero redirect

**Requirements:**
- Magento REST API integration token
- Braintree or Stripe configured as payment method in Magento
- Store on Adobe Commerce 2.4+ (REST API stable)

**Environment:**
- `MAGENTO_BASE_URL`
- `MAGENTO_ACCESS_TOKEN`
- `MAGENTO_STORE_CODE`

---

## VTEX

**Type:** Payment Provider Protocol (PPP)

**Integration model:** Zyon registers as a Payment Provider on VTEX. When buyer pays, VTEX sends card data directly to our endpoints for processing.

**Endpoints we must implement:**

| Route | Method | Function |
|---|---|---|
| `/manifest` | GET | Declare supported payment methods |
| `/payments` | POST | Receive payment, authorize via Asaas/Stripe |
| `/payments/:id/settlements` | POST | Capture (partial or full) |
| `/payments/:id/cancellations` | POST | Cancel/void transaction |
| `/payments/:id/refunds` | POST | Refund |

**Create Payment request (VTEX sends to us):**
```json
{
  "paymentId": "5B127F1E0C944EF9ACE264FEC1FC0E91",
  "transactionId": "611966",
  "paymentMethod": "Visa",
  "value": "29,90",
  "currency": "BRL",
  "installments": "3",
  "card": {
    "holder": "JOAO SILVA",
    "number": "4111111111111111",
    "csc": "123",
    "expiration": { "month": "12", "year": "2028" }
  },
  "miniCart": { "shippingValue": 11.44, "items": [...] },
  "callbackUrl": "https://vtex-callback-url",
  "returnUrl": "https://store-return-url"
}
```

**Manifest response:**
```json
{
  "paymentMethods": [
    { "name": "Visa", "allowsSplit": "onCapture" },
    { "name": "MasterCard", "allowsSplit": "onCapture" },
    { "name": "Pix", "allowsSplit": "disabled" },
    { "name": "BankInvoice", "allowsSplit": "onAuthorize" }
  ]
}
```

**Homologation process:**
1. Implement PPP endpoints above
2. Install "Payment Provider Test Suite" on VTEX Admin
3. Run automated tests against our sandbox endpoint
4. Fix any failures, re-run until all pass
5. Open ticket to VTEX support with:
   - Connector Name: `ZyonCheckout` (max 16 chars, immutable after publish)
   - Partner contact email
   - Production endpoint: `https://api.zyon.com.br/vtex`
   - Sandbox endpoint: `https://sandbox.api.zyon.com.br/vtex`
   - Owner account (VTEX test account)
   - Allowed accounts list
6. VTEX reviews and publishes connector

**Timeline estimate:** 2-4 weeks dev + 1-2 weeks VTEX review

**Environment:**
- `VTEX_APP_KEY`
- `VTEX_APP_TOKEN`
- `VTEX_ACCOUNT_NAME`

---

## Tray Commerce

**Type:** REST API + Transparent Checkout — **UNDER EVALUATION**

**Preliminary findings:**
- API at `https://api.tray.com.br/`
- Supports `POST /api/v1/orders` for order creation
- Supports `POST /api/v1/orders/{id}/payments` for payment
- Has "Checkout Transparente" (transparent checkout) — payment token generated via JS, sent to API for capture
- OAuth 2.0 Bearer Token authentication
- Sandbox available at `test.trayapp.com.br`

**Open questions (needs deeper analysis):**
- Can we fully bypass their checkout UI and process payment programmatically?
- What gateway restrictions exist?
- Is the transparent checkout token usable from our widget context?
- What are the partner/app requirements?

**Status:** Requires hands-on API testing to confirm viability.

---

## OpenAI

Conversation uses the OpenAI Responses API when `OPENAI_API_KEY` is set. Without it, the conversation engine returns safe deterministic fallback messages.

**Environment:**
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

---

## Asaas (Payment Gateway)

Primary payment processor for buyer transactions.

**Environment:**
- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_SECRET`
- `ASAAS_ENVIRONMENT` (sandbox | production)

---

## Integration Architecture

All commerce platform adapters implement a common port interface:

```
CommerceAdapter {
  createCart(items): CartResult
  createOrder(cart, customer, payment): OrderResult
  confirmPayment(orderId, transactionId): ConfirmResult
  cancelOrder(orderId, reason): CancelResult
  syncInventory(productIds): InventoryResult
}
```

Platform-specific logic lives in infrastructure adapters. Domain remains platform-agnostic.

---

## Roadmap Priority

1. **Embed** — Already active
2. **WooCommerce** — Largest open-source market share BR (~15%)
3. **Magento** — Enterprise BR, high ticket (~8-12%)
4. **VTEX** — Enterprise BR big players (~3-5%), requires homologation
5. **Tray Commerce** — Pending viability confirmation
