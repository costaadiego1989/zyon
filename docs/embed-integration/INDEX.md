# Athom Checkout Embed Documentation

Complete integration guide for embedding Athom's intelligent checkout widget into any e-commerce platform.

## Quick Navigation

| Document | Purpose |
|----------|---------|
| **[README.md](./README.md)** | Start here — quick start in 5 minutes, architecture overview |
| **[API_REFERENCE.md](./API_REFERENCE.md)** | Complete HTTP endpoint reference (sessions, checkout, payment) |
| **[CONFIGURATION.md](./CONFIGURATION.md)** | Widget customization, theming, scopes, permissions |
| **[WEBHOOKS.md](./WEBHOOKS.md)** | Receive real-time notifications (completion, payment, offers) |
| **[EXAMPLES.md](./EXAMPLES.md)** | Ready-to-use code (React, Vue, Next.js, Shopify, WooCommerce, Magento) |
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | Common issues and solutions |

## What is Athom Checkout Embed?

An AI-powered checkout widget that sits on your storefront and:

- **Detects objections** in real-time (expensive shipping, long delivery times, etc.)
- **Negotiates intelligently** via conversational AI
- **Suggests discounts** within merchant-configured limits
- **Processes payments** (Pix, card, boleto, crypto)
- **Works when API is down** — deterministic safe defaults keep checkout running

Revenue model: Fee per transaction + monthly plan.

---

## Getting Started

### 1. Get Your API Key

Sign up at [https://console.athom.io](https://console.athom.io) and create a service API key.

### 2. Install the SDK

```bash
npm install @zyon/agentic-checkout-js
```

Or load from CDN:

```html
<script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>
```

### 3. Issue a Token (Backend)

```bash
curl -X POST https://api.athom.io/embed-sessions \
  -H "Authorization: Bearer YOUR_SERVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "ttl_seconds": 900,
    "allowed_origin": "https://checkout.example.com",
    "scopes": ["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"]
  }'
```

### 4. Mount the Widget (Frontend)

```html
<zyon-checkout-agent
  session-token="EMBED_SESSION_TOKEN"
  api-url="https://api.athom.io"
  store-url="https://checkout.example.com"
  merchant-id="cm_abc123">
</zyon-checkout-agent>
```

### 5. Listen for Events

```javascript
window.addEventListener("message", (event) => {
  if (event.data?.type === "order:completed") {
    // Redirect to confirmation
    window.location.href = `/confirmation?order=${event.data.payload.order_id}`;
  }
});
```

**Done!** The widget is live on your storefront.

---

## Key Concepts

### Embed Session Token

A short-lived JWT that authorizes the widget to act on behalf of your merchant.

- Issued by your backend via `/embed-sessions`
- Signed with HMAC-SHA256
- Contains merchant ID, scopes, allowed origin
- Expires in 60–86,400 seconds
- One token per checkout session

### Scopes

Fine-grained permissions that control what the widget can do:

- `checkout:start` — Initialize session
- `checkout:chat` — Send/receive messages
- `checkout:track` — Track interactions
- `offers:apply` — Apply negotiated discounts
- `coupons:apply` — Apply customer coupons
- `payment:intents:create` — Create payment methods
- `payment:intents:confirm` — Confirm crypto payments

### Origin Binding

Restrict tokens to a specific storefront origin for security. The widget will reject requests from mismatched origins.

```json
{
  "allowed_origin": "https://checkout.example.com"
}
```

Required for production; optional for development.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Your Storefront (https://checkout.example.com)          │
│                                                         │
│ ┌───────────────────────────────────────────────────┐  │
│ │ <zyon-checkout-agent session-token="...">        │  │
│ │                                                  │  │
│ │ • Renders FAB (floating action button)          │  │
│ │ • Opens iframe with widget                      │  │
│ │ • Sends authenticated requests to Athom API     │  │
│ │ • Receives postMessage events on completion     │  │
│ └───────────────────────────────────────────────────┘  │
│                        ↓                               │
│              [postMessage event]                       │
│              ┌─────────────────┐                       │
│              │ order:completed │ → Redirect to        │
│              └─────────────────┘   confirmation       │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│ Your Backend                                            │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ GET /checkout → Call POST /embed-sessions           │ │
│ │ Issue token with scopes and allowed origin          │ │
│ │ Pass token to frontend                              │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│ Athom API (https://api.athom.io)                        │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ POST /embed-sessions (backend-only, API key auth)  │ │
│ │ POST /embed/start (token auth)                      │ │
│ │ POST /embed/chat (token auth)                       │ │
│ │ POST /embed/offers/apply (token auth)              │ │
│ │ POST /embed/payment/intents (token auth)           │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ • Validates tokens                                      │
│ • Enforces scopes and origin binding                    │
│ • Runs AI negotiation engine                           │
│ • Processes payments                                    │
│ • Logs events                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Integration Checklist

- [ ] Signed up at [https://console.athom.io](https://console.athom.io)
- [ ] Created a service API key
- [ ] Backend endpoint to issue tokens: `POST /api/embed-token`
- [ ] Frontend loads widget script or SDK
- [ ] Frontend passes token to widget
- [ ] Frontend listens for `order:completed` event
- [ ] Tested in sandbox environment
- [ ] Configured discount rules in Athom Console
- [ ] Set `allowed_origin` to production domain
- [ ] Deployed to production
- [ ] Monitored event logs and payment success rate

---

## Security Checklist

- [ ] **Never commit API keys** — Use environment variables
- [ ] **API key server-side only** — Never pass to frontend
- [ ] **Token TTL reasonable** — 900 seconds (15 min) is default
- [ ] **Origin binding enabled** — In production, always set `allowed_origin`
- [ ] **HTTPS everywhere** — All URLs must be HTTPS in production
- [ ] **Scope minimal** — Only request scopes your widget needs
- [ ] **postMessage origin check** — Always verify `event.origin` in listener
- [ ] **CSP headers set** — Allow widget iframe and API domain
- [ ] **Idempotency key unique** — Prevent duplicate payments
- [ ] **Webhook signature verification** — (Coming soon)

---

## Framework-Specific Guides

- **React**: See `EXAMPLES.md` → React section
- **Vue 3**: See `EXAMPLES.md` → Vue section
- **Next.js**: See `EXAMPLES.md` → Next.js section
- **Vanilla JS**: See `EXAMPLES.md` → Vanilla JS section
- **Shopify**: See `EXAMPLES.md` → Shopify section
- **WooCommerce**: See `EXAMPLES.md` → WooCommerce section
- **Magento**: See `EXAMPLES.md` → Magento section

---

## API Endpoints Reference

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/embed-sessions` | POST | API Key | Issue session token |
| `/embed/start` | POST | Token | Initialize checkout |
| `/embed/chat` | POST | Token | Send/receive messages |
| `/embed/track` | POST | Token | Track user interactions |
| `/embed/offers/apply` | POST | Token | Apply negotiated offer |
| `/embed/customer/update` | POST | Token | Update buyer info |
| `/embed/payment/intents` | POST | Token | Create payment |
| `/embed/payment/intents/:id/crypto/confirm` | POST | Token | Confirm crypto tx |

Full reference: [API_REFERENCE.md](./API_REFERENCE.md)

---

## Configuration & Customization

Customize widget appearance:

```html
<zyon-checkout-agent
  session-token="..."
  api-url="https://api.athom.io"
  store-url="https://checkout.example.com"
  merchant-id="cm_abc123"
  widget-position="bottom_right"
  fab-color="#3b82f6"
  start-minimized="true"
  show-cart-badge="true">
</zyon-checkout-agent>
```

CSS theme variables:

```css
:root {
  --aacp-primary: #3b82f6;
  --aacp-secondary: #10b981;
  --aacp-danger: #ef4444;
  --aacp-radius: 8px;
}
```

Full guide: [CONFIGURATION.md](./CONFIGURATION.md)

---

## Webhooks

Receive real-time notifications:

- `checkout.completed` — Order placed
- `payment.confirmed` — Payment succeeded
- `offer.applied` — Discount accepted
- `payment.failed` — Payment declined

[WEBHOOKS.md](./WEBHOOKS.md)

---

## Troubleshooting

Common issues:

| Issue | Solution |
|-------|----------|
| `invalid_embed_session_token` | Token expired; issue a fresh one |
| `embed_origin_not_allowed` | Page origin doesn't match `allowed_origin` |
| `embed_scope_insufficient` | Token missing required scope |
| Widget not rendering | Check script is loaded; verify token is set |
| postMessage not received | Verify listener added; check `store-url` origin |
| CORS errors | API uses HTTPS; ensure `api-url` is HTTPS |

Full guide: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## Support & Resources

- **Status**: [https://status.athom.io](https://status.athom.io)
- **GitHub**: [https://github.com/athom-checkout/](https://github.com/athom-checkout/) (SDK + examples)
- **Email**: [support@athom.io](mailto:support@athom.io)
- **Console**: [https://console.athom.io](https://console.athom.io)

---

## Version History

| Version | Release | Notes |
|---------|---------|-------|
| v2.1.0 | 2024-01-15 | Crypto payments, enhanced security |
| v2.0.0 | 2024-01-10 | Web component, origin binding, scopes |
| v1.0.0 | 2023-12-01 | MVP: chat, offers, Pix/card payments |

---

## License

Athom Checkout Embed SDK is licensed under the [MIT License](./LICENSE).

---

**Last Updated**: January 2024  
**SDK Version**: v2.1.0  
**API Version**: v1
