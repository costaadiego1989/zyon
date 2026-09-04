# Athom Checkout Embed — Integration Guide

Embed an intelligent checkout widget with AI-powered negotiation into any e-commerce platform. The widget qualifies objections, suggests discounts, and handles payment in seconds.

## Quick Start (5 minutes)

### 1. Install

```bash
npm install @zyon/agentic-checkout-js
```

### 2. Get an Embed Token

Call your backend to issue a short-lived embed session token:

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

Response:
```json
{
  "embed_session_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_at_unix": 1692914400,
  "scopes": ["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"]
}
```

### 3. Add the Widget to Your Page

```html
<script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>

<zyon-checkout-agent
  session-token="EMBED_SESSION_TOKEN"
  api-url="https://api.athom.io"
  store-url="https://checkout.example.com"
  merchant-id="your_merchant_id">
</zyon-checkout-agent>
```

### 4. Listen for Completion Events

```javascript
window.addEventListener("message", (event) => {
  if (event.data?.type === "order:completed") {
    console.log("Order placed:", event.data.payload);
    // Redirect to confirmation page, update cart, etc.
  }
});
```

## That's it!

The widget now handles cart qualification, AI chat, discount negotiation, and payment. No additional setup required for the happy path.

---

## What the Widget Does

- **Objection Detection**: Identifies cart abandonment signals (high shipping, expensive items, long delivery)
- **AI Negotiation**: Agent suggests targeted discounts, free shipping, or delivery guarantees
- **Payment Processing**: Accepts Pix, card, boleto, and crypto payments
- **Merchant Controls**: Configure which interventions trigger, suppress by region/cart value, set discount caps
- **Full Fallback**: If the AI is unavailable, deterministic safe defaults keep checkout running

---

## Key Concepts

### Embed Session Token

A signed JWT that binds the widget to your merchant context and controls scope (what the widget can do).

- **Issued by**: Your backend via `/embed-sessions` endpoint
- **Duration**: 60–86,400 seconds (default 900s = 15 min)
- **Origin Binding**: Optional; restricts token to a specific storefront origin (recommended)
- **Scopes**: Control which operations the widget can perform
- **Signature**: HMAC-SHA256 signed with `EMBED_TOKEN_SECRET`

### Scopes

Scopes define what the widget can do within the browser:

| Scope | Purpose |
|-------|---------|
| `checkout:start` | Initialize checkout session and load cart |
| `checkout:chat` | Send/receive AI negotiation messages |
| `checkout:track` | Track user interactions (clicks, page views, scroll) |
| `offers:apply` | Apply merchant-approved discounts |
| `coupons:apply` | Apply customer-provided coupons |
| `payment:intents:create` | Create payment intents for Pix/card/boleto/crypto |
| `payment:intents:confirm` | Confirm crypto payments (on-chain transactions) |
| `payment:intents:read` | Check payment intent status |

**Typical scopes for a storefront**:
```json
["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"]
```

### Architecture

```
Your Storefront
     ↓
   ↙ ↘
Browser             Your Backend
  ↓                    ↓
[Widget iframe] ← [POST /embed-sessions] ← [HMAC Sign Token]
  ↓
[POST /embed/chat]
[POST /embed/offers/apply]
[POST /embed/payment/intents]
```

1. **Your backend** calls `POST /embed-sessions` with API key
2. **Backend** returns signed token to frontend
3. **Frontend** mounts `<zyon-checkout-agent>` with that token
4. **Widget** makes authenticated requests directly to Athom API using the token
5. **Widget** posts completion events back to parent window

---

## Integration Methods

### Method 1: Web Component (Recommended)

Simplest for any framework. The widget is a self-contained web component.

```html
<!DOCTYPE html>
<html>
  <head>
    <script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>
  </head>
  <body>
    <zyon-checkout-agent
      session-token="eyJ..."
      api-url="https://api.athom.io"
      store-url="https://checkout.example.com"
      merchant-id="cm_abc123">
    </zyon-checkout-agent>

    <script>
      window.addEventListener("message", (event) => {
        if (event.origin !== "https://checkout.example.com") return; // Origin check
        if (event.data?.type === "order:completed") {
          console.log("Order ID:", event.data.payload.order_id);
          // Redirect or update UI
        }
      });
    </script>
  </body>
</html>
```

### Method 2: React

```tsx
import { useEffect } from "react";

export function CheckoutPage() {
  const [token, setToken] = useState("");

  useEffect(() => {
    // Get token from your backend
    fetch("/api/embed-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 900 })
    })
      .then(r => r.json())
      .then(data => setToken(data.embed_session_token));
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://checkout.example.com") return;
      if (event.data?.type === "order:completed") {
        console.log("Order completed:", event.data.payload);
        // Navigate to confirmation
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (!token) return <div>Loading checkout...</div>;

  return (
    <>
      <zyon-checkout-agent
        session-token={token}
        api-url="https://api.athom.io"
        store-url="https://checkout.example.com"
        merchant-id="cm_abc123"
      />
    </>
  );
}
```

### Method 3: Vue 3

```vue
<template>
  <div>
    <zyon-checkout-agent
      v-if="token"
      :session-token="token"
      api-url="https://api.athom.io"
      store-url="https://checkout.example.com"
      merchant-id="cm_abc123">
    </zyon-checkout-agent>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const token = ref("");

onMounted(async () => {
  const response = await fetch("/api/embed-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 900 })
  });
  const data = await response.json();
  token.value = data.embed_session_token;

  const handleMessage = (event: MessageEvent) => {
    if (event.data?.type === "order:completed") {
      console.log("Order completed:", event.data.payload);
      // Handle completion
    }
  };
  window.addEventListener("message", handleMessage);
});

onUnmounted(() => {
  window.removeEventListener("message", handleMessage);
});
</script>
```

### Method 4: Next.js

```tsx
// pages/checkout.tsx
import { GetServerSideProps } from "next";
import { useEffect, useState } from "react";

interface CheckoutProps {
  embedToken: string;
}

export const getServerSideProps: GetServerSideProps<CheckoutProps> = async () => {
  const response = await fetch("https://api.athom.io/embed-sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AACP_SERVICE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ttl_seconds: 900,
      allowed_origin: process.env.NEXT_PUBLIC_STORE_URL,
      scopes: ["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"]
    })
  });

  const data = await response.json();
  return { props: { embedToken: data.embed_session_token } };
};

export default function CheckoutPage({ embedToken }: CheckoutProps) {
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    window.addEventListener("message", (event) => {
      if (event.origin !== process.env.NEXT_PUBLIC_STORE_URL) return;
      if (event.data?.type === "order:completed") {
        setCompleted(true);
        // Redirect after 2 seconds
        setTimeout(() => {
          window.location.href = "/confirmation";
        }, 2000);
      }
    });
  }, []);

  return (
    <div className="checkout-page">
      {completed && <div>✓ Order placed!</div>}
      <zyon-checkout-agent
        session-token={embedToken}
        api-url="https://api.athom.io"
        store-url={process.env.NEXT_PUBLIC_STORE_URL}
        merchant-id={process.env.NEXT_PUBLIC_MERCHANT_ID}
      />
    </div>
  );
}
```

---

## Backend Integration

Your backend must issue embed tokens. Example Node.js:

```javascript
// POST /api/embed-token
import fetch from "node-fetch";

export async function issueEmbedToken(req, res) {
  const response = await fetch("https://api.athom.io/embed-sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AACP_SERVICE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ttl_seconds: req.body.ttl_seconds || 900,
      allowed_origin: process.env.STORE_URL,
      scopes: [
        "checkout:start",
        "checkout:chat",
        "offers:apply",
        "payment:intents:create"
      ]
    })
  });

  const data = await response.json();
  res.json({ embed_session_token: data.embed_session_token });
}
```

Example Python (Flask):

```python
import requests
import os

@app.route("/api/embed-token", methods=["POST"])
def issue_embed_token():
    response = requests.post(
        "https://api.athom.io/embed-sessions",
        headers={
            "Authorization": f"Bearer {os.environ['AACP_SERVICE_API_KEY']}",
            "Content-Type": "application/json"
        },
        json={
            "ttl_seconds": 900,
            "allowed_origin": os.environ["STORE_URL"],
            "scopes": [
                "checkout:start",
                "checkout:chat",
                "offers:apply",
                "payment:intents:create"
            ]
        }
    )
    data = response.json()
    return {"embed_session_token": data["embed_session_token"]}
```

---

## Configuration

See [CONFIGURATION.md](./CONFIGURATION.md) for widget customization (colors, fonts, triggers, behavior modes).

## API Reference

See [API_REFERENCE.md](./API_REFERENCE.md) for full endpoint documentation.

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues (CORS, auth, postMessage).

## Examples

See [EXAMPLES.md](./EXAMPLES.md) for working demos (Shopify, WooCommerce, Magento, custom storefronts).
