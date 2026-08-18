# Configuration & Customization

Customize the widget appearance, behavior, and triggers.

## Web Component Attributes

Set attributes on the `<zyon-checkout-agent>` element:

```html
<zyon-checkout-agent
  session-token="eyJ0eXAiOiJhYWNw..."
  api-url="https://api.athom.io"
  store-url="https://checkout.example.com"
  merchant-id="cm_abc123"
  widget-position="bottom_right"
  fab-color="#3b82f6"
  start-minimized="true"
  show-cart-badge="true">
</zyon-checkout-agent>
```

### Required Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `session-token` | string | Embed session token from `/embed-sessions` |
| `api-url` | string | API base URL (e.g., `https://api.athom.io`) |
| `store-url` | string | Your storefront URL; used as `postMessage` targetOrigin |
| `merchant-id` | string | Your merchant ID |

### Optional Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `widget-position` | string | `bottom_right` | Position: `bottom_right`, `bottom_left`, `top_right`, `top_left` |
| `fab-color` | string | `#3b82f6` | Floating action button color (hex) |
| `fab-text` | string | `Posso ajudar?` | FAB invite text |
| `start-minimized` | boolean | `true` | Start widget collapsed/minimized |
| `show-cart-badge` | boolean | `true` | Show item count badge on FAB |
| `presentation-mode` | string | `fab` | `fab` (floating button) or `embedded` (inline) |

---

## Merchant Configuration (Server-Side)

Configure default behavior for your merchant in the Athom Console or via the Merchant Settings API.

### Key Settings

#### Widget Behavior

- **Position**: `bottom_right`, `bottom_left`, `top_right`, `top_left`
- **Start Minimized**: Open widget collapsed or expanded
- **Presentation Mode**: Floating action button or embedded panel
- **Cart Badge**: Show/hide item count badge
- **Invite Text**: Customizable opening message

#### Intervention Policy

- **Minimum Abandonment Score**: 0–1 (0.7 = 70% confidence before agent intervenes)
- **Cooldown Seconds**: Minimum wait between interventions (default 120s)
- **Max Interventions Per Session**: Prevent repeated popups (default 3)

#### Discount Caps

The merchant's rules engine enforces caps. The widget never offers more than:
- **Maximum Discount**: `X%` of item price
- **Minimum Margin**: Ensure profit after discount
- **Maximum Free Shipping Subsidy**: `R$ Y` per order

#### Triggers

Which buyer signals trigger the widget to open:

| Trigger | Detected When | Default | Example |
|---------|---|---------|---------|
| `shipping_objection_detected` | Buyer hovers/clicks shipping | ✓ | "Frete muito caro" |
| `coupon_field_clicked` | Buyer clicks coupon input | ✓ | Looking for discount code |
| `payment_failed` | First payment attempt fails | ✓ | Card declined |
| `idle_30_seconds` | No interaction for 30s | ✓ | Browsing checkout |
| `exit_intent_detected` | Mouse leaves viewport | ✓ | About to close tab |

#### Suppression Rules

When NOT to intervene:

- **Blocked Regions**: Don't show widget for certain countries/states
- **Minimum Cart Value**: Only intervene if cart ≥ `R$ Z`
- **Suppress After Offer Accepted**: Don't re-offer after buyer accepts
- **Respect Buyer Opt-Out**: Honor `do_not_show_checkout_widget` cookie

---

## Theming

Customize colors, fonts, and appearance via CSS variables. The widget respects:

### Light Mode (default)

```css
:root {
  --aacp-primary: #3b82f6;         /* Primary action button */
  --aacp-primary-hover: #2563eb;
  --aacp-secondary: #10b981;       /* Success, confirmations */
  --aacp-danger: #ef4444;          /* Errors, cancellations */
  --aacp-background: #ffffff;
  --aacp-surface: #f9fafb;
  --aacp-text: #111827;
  --aacp-text-secondary: #6b7280;
  --aacp-border: #e5e7eb;
  --aacp-shadow: rgba(0, 0, 0, 0.1);
  --aacp-radius: 8px;              /* Border radius */
  --aacp-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

### Dark Mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --aacp-primary: #60a5fa;
    --aacp-primary-hover: #3b82f6;
    --aacp-secondary: #34d399;
    --aacp-danger: #f87171;
    --aacp-background: #1f2937;
    --aacp-surface: #111827;
    --aacp-text: #f9fafb;
    --aacp-text-secondary: #d1d5db;
    --aacp-border: #374151;
    --aacp-shadow: rgba(0, 0, 0, 0.3);
  }
}
```

### Override Example

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      :root {
        --aacp-primary: #7c3aed;    /* Purple instead of blue */
        --aacp-radius: 4px;         /* Sharper corners */
      }
    </style>
    <script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>
  </head>
  <body>
    <zyon-checkout-agent
      session-token="..."
      api-url="https://api.athom.io"
      store-url="https://checkout.example.com"
      merchant-id="cm_abc123">
    </zyon-checkout-agent>
  </body>
</html>
```

---

## Message Events

### Order Completion Event

When a buyer completes payment, the widget sends:

```javascript
window.parent.postMessage({
  type: "order:completed",
  payload: {
    order_id: "ord_abc123",
    session_id: "session_xyz",
    total_amount: 27400,
    currency: "BRL",
    payment_method: "pix",
    offer_applied: {
      id: "offer_789",
      type: "free_shipping",
      discount_amount: 2500
    },
    timestamp: "2024-01-15T14:30:00Z"
  }
}, "https://checkout.example.com");
```

**Listen**:

```javascript
window.addEventListener("message", (event) => {
  if (event.origin !== "https://checkout.example.com") return;
  if (event.data?.type === "order:completed") {
    const { order_id, total_amount } = event.data.payload;
    console.log(`Order ${order_id} completed for R$ ${total_amount / 100}`);
    // Redirect to confirmation page
    window.location.href = `/confirmation?order=${order_id}`;
  }
});
```

### Error Event

If payment fails or the session expires:

```javascript
window.parent.postMessage({
  type: "order:error",
  payload: {
    session_id: "session_xyz",
    error: "payment_declined",
    message: "Cartão recusado"
  }
}, "https://checkout.example.com");
```

### Ready Event

When the widget is fully loaded:

```javascript
window.parent.postMessage({
  type: "widget:ready",
  payload: {
    session_id: "session_xyz",
    merchant_id: "cm_abc123"
  }
}, "https://checkout.example.com");
```

---

## Advanced: Scopes & Permissions

Control what the widget can do by issuing tokens with specific scopes.

### Minimal Scope (Read-Only)

For initial exploration without payment:

```json
["checkout:start", "checkout:chat"]
```

Widget can:
- Start session
- Send/receive chat messages
- Receive agent suggestions

Cannot:
- Apply discounts
- Create payments
- Charge cards

### Full Scope (Checkout)

For complete checkout flow:

```json
[
  "checkout:start",
  "checkout:chat",
  "checkout:track",
  "offers:apply",
  "coupons:apply",
  "payment:intents:create"
]
```

### Admin Scope (Development Only)

For testing in sandbox:

```json
[
  "checkout:start",
  "checkout:chat",
  "checkout:track",
  "offers:apply",
  "coupons:apply",
  "payment:intents:create",
  "payment:intents:confirm",
  "payment:intents:read"
]
```

---

## Environment-Specific Configuration

### Production

- **API URL**: `https://api.athom.io`
- **Environment**: `live`
- **Discount Caps**: Enforced; cannot exceed merchant rules
- **Payment Methods**: All (Pix, card, boleto, crypto)
- **Failed Payments**: Hard stop; retry limited

### Sandbox / Testing

- **API URL**: `https://sandbox.api.athom.io`
- **Environment**: `test`
- **Discount Caps**: Relaxed for testing
- **Payment Methods**: Test cards only
- **Failed Payments**: Resettable; infinite retries for testing

### Development / Local

```html
<zyon-checkout-agent
  session-token="__dev_bypass__"
  api-url="http://localhost:3000"
  store-url="http://localhost:3001"
  merchant-id="mrc_dev_seed">
</zyon-checkout-agent>
```

**Dev bypass** requires `EMBED_DEV_BYPASS=true` in your API `.env`.

---

## Migration Guide

### From v1 to v2

v2 adds:
- Enhanced security with origin binding
- Scope-based permissions
- Crypto payment support
- Improved error handling

**Breaking changes**:
- Attribute names changed (`session_token` → `session-token`, kebab-case)
- Message event format updated
- Origin binding now required for transactional scopes

**Upgrade**:

```html
<!-- v1 (deprecated) -->
<zyon-checkout-agent
  session_token="..."
  api_url="https://api.athom.io">
</zyon-checkout-agent>

<!-- v2 (current) -->
<zyon-checkout-agent
  session-token="..."
  api-url="https://api.athom.io"
  store-url="https://checkout.example.com">
</zyon-checkout-agent>
```
