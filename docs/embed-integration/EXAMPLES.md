# Examples

Ready-to-use integration examples for common platforms.

## Vanilla JavaScript

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Checkout with Athom</title>
    <script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        padding: 20px;
        background: #f9fafb;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }
      .product {
        border: 1px solid #e5e7eb;
        padding: 15px;
        margin-bottom: 15px;
        border-radius: 6px;
      }
      .product h3 {
        margin: 0 0 10px 0;
        font-size: 18px;
      }
      .price {
        font-size: 20px;
        font-weight: bold;
        color: #3b82f6;
        margin: 10px 0;
      }
      .status {
        margin-top: 20px;
        padding: 15px;
        background: #f0fdf4;
        border: 1px solid #86efac;
        border-radius: 6px;
        display: none;
      }
      .status.show {
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Checkout</h1>

      <div class="product">
        <h3>Wireless Headphones</h3>
        <p>High-quality sound with noise cancellation</p>
        <div class="price">R$ 299.00</div>
      </div>

      <!-- The widget will render here -->
      <zyon-checkout-agent
        id="aacp-widget"
        api-url="https://api.athom.io"
        store-url="https://checkout.example.com"
        merchant-id="cm_your_merchant_id">
      </zyon-checkout-agent>

      <!-- Status message -->
      <div class="status" id="status"></div>
    </div>

    <script>
      // 1. Get token from your backend
      async function getEmbedToken() {
        const response = await fetch("/api/embed-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ttl_seconds: 900 })
        });
        if (!response.ok) throw new Error("Failed to get embed token");
        const data = await response.json();
        return data.embed_session_token;
      }

      // 2. Set token on widget
      async function initWidget() {
        const token = await getEmbedToken();
        const widget = document.getElementById("aacp-widget");
        widget.setAttribute("session-token", token);
      }

      // 3. Listen for completion
      window.addEventListener("message", (event) => {
        // Always verify origin
        if (event.origin !== "https://checkout.example.com") return;

        if (event.data?.type === "order:completed") {
          const { order_id, total_amount } = event.data.payload;
          showStatus(`✓ Order ${order_id} placed!`, "success");
          
          // Redirect after 3 seconds
          setTimeout(() => {
            window.location.href = `/confirmation?order=${order_id}`;
          }, 3000);
        }

        if (event.data?.type === "order:error") {
          showStatus(`✗ Error: ${event.data.payload.message}`, "error");
        }
      });

      // 4. Helper to show status
      function showStatus(message, type) {
        const status = document.getElementById("status");
        status.textContent = message;
        status.className = `status show ${type}`;
      }

      // Initialize when DOM is ready
      initWidget();
    </script>
  </body>
</html>
```

**Backend** (Node.js):

```javascript
// POST /api/embed-token
app.post("/api/embed-token", async (req, res) => {
  const response = await fetch("https://api.athom.io/embed-sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AACP_SERVICE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ttl_seconds: 900,
      allowed_origin: "https://checkout.example.com",
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
});
```

---

## React

```tsx
import { useEffect, useState } from "react";

export function CheckoutPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ type: string; message: string } | null>(null);

  // Get token from backend
  useEffect(() => {
    fetch("/api/embed-token", { method: "POST" })
      .then(r => r.json())
      .then(data => {
        setToken(data.embed_session_token);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to get token:", err);
        setLoading(false);
      });
  }, []);

  // Listen for widget events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://checkout.example.com") return;

      if (event.data?.type === "order:completed") {
        setStatus({ type: "success", message: "✓ Order placed!" });
        setTimeout(() => {
          window.location.href = `/confirmation?order=${event.data.payload.order_id}`;
        }, 2000);
      }

      if (event.data?.type === "order:error") {
        setStatus({ type: "error", message: `✗ ${event.data.payload.message}` });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (loading) return <div>Loading checkout...</div>;
  if (!token) return <div>Failed to initialize checkout.</div>;

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "20px" }}>
      <h1>Checkout</h1>

      {status && (
        <div
          style={{
            padding: "10px",
            marginBottom: "20px",
            background: status.type === "success" ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${status.type === "success" ? "#86efac" : "#fecaca"}`,
            borderRadius: "6px"
          }}
        >
          {status.message}
        </div>
      )}

      {/* Widget renders here */}
      <zyon-checkout-agent
        session-token={token}
        api-url="https://api.athom.io"
        store-url="https://checkout.example.com"
        merchant-id="cm_your_merchant_id"
      />
    </div>
  );
}
```

---

## Next.js 14+ (App Router)

```tsx
// app/checkout/page.tsx
import { cookies } from "next/headers";
import { CheckoutClient } from "./checkout-client";

async function getEmbedToken() {
  const response = await fetch(`${process.env.API_URL}/embed-sessions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AACP_SERVICE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ttl_seconds: 900,
      allowed_origin: process.env.NEXT_PUBLIC_STORE_URL,
      scopes: [
        "checkout:start",
        "checkout:chat",
        "offers:apply",
        "payment:intents:create"
      ]
    })
  });

  if (!response.ok) throw new Error("Failed to issue token");
  const data = await response.json();
  return data.embed_session_token;
}

export default async function CheckoutPage() {
  const token = await getEmbedToken();

  return <CheckoutClient token={token} />;
}
```

```tsx
// app/checkout/checkout-client.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface CheckoutClientProps {
  token: string;
}

export function CheckoutClient({ token }: CheckoutClientProps) {
  const router = useRouter();
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const storeUrl = process.env.NEXT_PUBLIC_STORE_URL;
      if (!storeUrl || event.origin !== storeUrl) return;

      if (event.data?.type === "order:completed") {
        setCompleted(true);
        const { order_id } = event.data.payload;
        setTimeout(() => {
          router.push(`/confirmation?order=${order_id}`);
        }, 1500);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router]);

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Checkout</h1>

      {completed && (
        <div className="bg-green-50 border border-green-300 rounded p-4 mb-6">
          ✓ Order placed! Redirecting to confirmation...
        </div>
      )}

      <zyon-checkout-agent
        session-token={token}
        api-url="https://api.athom.io"
        store-url={process.env.NEXT_PUBLIC_STORE_URL}
        merchant-id={process.env.NEXT_PUBLIC_MERCHANT_ID}
      />
    </main>
  );
}
```

---

## Shopify (Liquid Theme)

```liquid
<!-- In your theme's checkout or cart template -->
<script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>

<div id="athom-checkout"></div>

<script>
  // Fetch token from your endpoint
  fetch('/api/athom-embed-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cartTotal: {{ cart.total_price }},
      cartItems: {{ cart.items | json }}
    })
  })
  .then(r => r.json())
  .then(data => {
    // Create and mount widget
    const container = document.getElementById('athom-checkout');
    const widget = document.createElement('zyon-checkout-agent');
    widget.setAttribute('session-token', data.embed_session_token);
    widget.setAttribute('api-url', 'https://api.athom.io');
    widget.setAttribute('store-url', window.location.origin);
    widget.setAttribute('merchant-id', '{{ shop.id }}');
    container.appendChild(widget);
  });

  // Handle completion
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'order:completed') {
      // Redirect to Shopify checkout
      window.location.href = '/checkout';
    }
  });
</script>
```

**Backend** (Node.js + Shopify API):

```javascript
// POST /api/athom-embed-token
app.post("/api/athom-embed-token", async (req, res) => {
  const shopifyClient = new shopify.clients.Rest({
    session: req.session
  });

  // Get token from Athom
  const response = await fetch("https://api.athom.io/embed-sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.AACP_SERVICE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ttl_seconds: 900,
      allowed_origin: `https://${req.session.shop}`,
      scopes: ["checkout:start", "checkout:chat", "offers:apply", "payment:intents:create"]
    })
  });

  const data = await response.json();
  res.json({ embed_session_token: data.embed_session_token });
});
```

---

## WooCommerce (WordPress)

```php
<?php
// In your theme's checkout template

add_action('woocommerce_review_order_before_payment', function() {
  $token = get_embed_token();
  if (!$token) return;
  
  echo '<div id="athom-widget"></div>';
  echo '<script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>';
  echo '<script>';
  echo sprintf(
    'const widget = document.createElement("zyon-checkout-agent");
     widget.setAttribute("session-token", "%s");
     widget.setAttribute("api-url", "https://api.athom.io");
     widget.setAttribute("store-url", "%s");
     widget.setAttribute("merchant-id", "%s");
     document.getElementById("athom-widget").appendChild(widget);',
    esc_js($token),
    esc_url(site_url()),
    esc_js(get_option('woocommerce_store_name'))
  );
  echo '</script>';
});

function get_embed_token() {
  $response = wp_remote_post('https://api.athom.io/embed-sessions', [
    'headers' => [
      'Authorization' => 'Bearer ' . getenv('AACP_SERVICE_API_KEY'),
      'Content-Type' => 'application/json'
    ],
    'body' => json_encode([
      'ttl_seconds' => 900,
      'allowed_origin' => site_url(),
      'scopes' => ['checkout:start', 'checkout:chat', 'offers:apply', 'payment:intents:create']
    ])
  ]);

  if (is_wp_error($response)) {
    return null;
  }

  $data = json_decode(wp_remote_retrieve_body($response), true);
  return $data['embed_session_token'] ?? null;
}
```

---

## Magento 2

```xml
<!-- app/code/Athom/CheckoutWidget/view/frontend/layout/checkout_index_index.xml -->
<?xml version="1.0"?>
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:View/Layout/etc/page_configuration.xsd">
  <body>
    <referenceContainer name="checkout.root">
      <block class="Athom\CheckoutWidget\Block\Widget" name="athom.widget" template="widget.phtml" />
    </referenceContainer>
  </body>
</page>
```

```php
<?php
// app/code/Athom/CheckoutWidget/Block/Widget.php
namespace Athom\CheckoutWidget\Block;

class Widget extends \Magento\Framework\View\Element\Template
{
  protected $_httpClient;

  public function __construct(
    \Magento\Framework\View\Element\Template\Context $context,
    \Magento\Framework\HTTP\Client\Curl $httpClient
  ) {
    parent::__construct($context);
    $this->_httpClient = $httpClient;
  }

  public function getEmbedToken()
  {
    $storeUrl = $this->_storeManager->getStore()->getBaseUrl();
    
    $this->_httpClient->post(
      'https://api.athom.io/embed-sessions',
      json_encode([
        'ttl_seconds' => 900,
        'allowed_origin' => rtrim($storeUrl, '/'),
        'scopes' => ['checkout:start', 'checkout:chat', 'offers:apply', 'payment:intents:create']
      ]),
      ['Authorization' => 'Bearer ' . getenv('AACP_SERVICE_API_KEY')]
    );

    $body = json_decode($this->_httpClient->getBody(), true);
    return $body['embed_session_token'] ?? null;
  }
}
```

```php
<?php
// app/code/Athom/CheckoutWidget/view/frontend/templates/widget.phtml
?>
<script src="https://cdn.athom.io/widget/latest/embed.umd.js"></script>
<div id="athom-checkout"></div>

<script>
  const token = "<?php echo $block->escapeJs($block->getEmbedToken()); ?>";
  if (token) {
    const widget = document.createElement('zyon-checkout-agent');
    widget.setAttribute('session-token', token);
    widget.setAttribute('api-url', 'https://api.athom.io');
    widget.setAttribute('store-url', window.location.origin);
    widget.setAttribute('merchant-id', '<?php echo $block->escapeJs($block->getMerchantId()); ?>');
    document.getElementById('athom-checkout').appendChild(widget);
  }
</script>
```

---

## Debugging Tips

### Chrome DevTools

1. Open DevTools (`F12`)
2. Go to **Console** tab
3. Look for `[aacp]` logs

Enable verbose logging:

```javascript
localStorage.setItem("AACP_DEBUG", "true");
// Reload page
```

### Network Tab

Monitor these requests:

- `POST /embed-sessions` — Session token issuance
- `POST /embed/start` — Checkout initialization
- `POST /embed/chat` — Chat messages
- `POST /embed/payment/intents` — Payment creation

### Verify Origin

Confirm your `store-url` matches the domain:

```javascript
console.log("Current origin:", window.location.origin);
console.log("Store URL attribute:", document.querySelector('zyon-checkout-agent')?.getAttribute('store-url'));
// They should match
```

---

## Need Help?

- **Docs**: [https://docs.athom.io/embed](https://docs.athom.io/embed)
- **Status**: [https://status.athom.io](https://status.athom.io)
- **Support Email**: [support@athom.io](mailto:support@athom.io)
