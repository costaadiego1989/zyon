# API Security Best Practices

## API Key Handling

### Rule #1: Never expose API keys in client-side code

API keys (`aacp_live_*` / `aacp_test_*`) are **server-side secrets**. They must never appear in:
- Browser JavaScript (React, Vue, Angular SPAs)
- Mobile app bundles (React Native, Flutter, Swift, Kotlin)
- Public repositories
- Client-side environment variables (`NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`)

If a key is exposed, anyone can make requests as your merchant — read orders, create checkouts, access customer data.

---

## Integration Patterns by Stack

### Pattern A: Server-Side Frameworks (Recommended)

Frameworks with server-side rendering can call the API directly from the server. The key never reaches the browser.

**Next.js (App Router)**
```typescript
// app/api/products/route.ts — server-side only
export async function GET() {
  const res = await fetch('https://api.aacp.dev/v1/products', {
    headers: { Authorization: `Bearer ${process.env.AACP_API_KEY}` },
  });
  return Response.json(await res.json());
}

// Client component calls YOUR route, not the API directly
const products = await fetch('/api/products');
```

**Nuxt 3**
```typescript
// server/api/products.ts
export default defineEventHandler(async () => {
  const data = await $fetch('https://api.aacp.dev/v1/products', {
    headers: { Authorization: `Bearer ${process.env.AACP_API_KEY}` },
  });
  return data;
});
```

**Laravel**
```php
// routes/api.php
Route::get('/products', function () {
    $response = Http::withHeaders([
        'Authorization' => 'Bearer ' . config('services.aacp.key'),
    ])->get('https://api.aacp.dev/v1/products');

    return $response->json();
});
```

**Django**
```python
# views.py
import requests
from django.conf import settings
from django.http import JsonResponse

def products(request):
    response = requests.get(
        'https://api.aacp.dev/v1/products',
        headers={'Authorization': f'Bearer {settings.AACP_API_KEY}'}
    )
    return JsonResponse(response.json())
```

---

### Pattern B: API Gateway (Production-Grade)

For production deployments with multiple services, use an **API Gateway** to centralize authentication, rate limiting, and routing.

**Kong Gateway (Recommended)**

Kong sits between your clients and our API. It injects the API key, handles rate limiting, caching, and logging — your frontend code stays clean.

```yaml
# kong.yml — declarative config
services:
  - name: aacp-api
    url: https://api.aacp.dev/v1
    routes:
      - name: aacp-products
        paths:
          - /api/products
        methods:
          - GET
      - name: aacp-checkouts
        paths:
          - /api/checkouts
        methods:
          - POST
          - GET
      - name: aacp-orders
        paths:
          - /api/orders
        methods:
          - GET

plugins:
  - name: request-transformer
    config:
      add:
        headers:
          - "Authorization: Bearer ${AACP_API_KEY}"
      remove:
        headers:
          - Authorization  # strip any client-sent auth

  - name: rate-limiting
    config:
      minute: 100
      policy: local

  - name: cors
    config:
      origins:
        - "https://yourapp.com"
      methods:
        - GET
        - POST
        - PATCH
      headers:
        - Content-Type
        - Idempotency-Key

  - name: response-transformer
    config:
      remove:
        headers:
          - X-RateLimit-Limit    # hide our rate limits from end users
          - X-RateLimit-Remaining
```

**Why Kong:**

| Benefit | Without Kong | With Kong |
|---------|-------------|-----------|
| API key injection | Every backend route manually | One config |
| Rate limiting (your users) | Build yourself | Plugin |
| Caching | Build yourself | Plugin (proxy-cache) |
| Request logging | Manual | Plugin (file-log, http-log) |
| Auth for your users | Build yourself | Plugin (key-auth, jwt, oauth2) |
| IP whitelisting | Nginx config | Plugin (ip-restriction) |
| Circuit breaker | Build yourself | Plugin |

**Docker Compose with Kong:**

```yaml
services:
  kong:
    image: kong:3.7
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /etc/kong/kong.yml
      KONG_PROXY_LISTEN: "0.0.0.0:8000"
      KONG_ADMIN_LISTEN: "0.0.0.0:8001"
      AACP_API_KEY: ${AACP_API_KEY}
    ports:
      - "8000:8000"  # proxy
      - "8001:8001"  # admin
    volumes:
      - ./kong.yml:/etc/kong/kong.yml:ro
```

**Flow:**
```
Browser → https://yourapp.com/api/products
       → Kong (port 8000) injects Bearer key
       → https://api.aacp.dev/v1/products
       → Response back through Kong
       → Browser receives data (never sees key)
```

**Other API Gateways:**

| Gateway | Best For |
|---------|----------|
| **Kong** | Self-hosted, plugin ecosystem, declarative config |
| **AWS API Gateway** | AWS-native, Lambda integration |
| **Cloudflare Workers** | Edge, fast, zero cold start |
| **Traefik** | Docker-native, auto-discovery |
| **NGINX** | Simple proxy, already in stack |
| **Apigee** | Enterprise, Google Cloud |

---

### Pattern C: BFF (Backend-for-Frontend)

For React SPAs, React Native, or Flutter — create a thin backend that acts as proxy.

**Express.js BFF**
```typescript
// server.ts — your BFF
import express from 'express';

const app = express();
const AACP_KEY = process.env.AACP_API_KEY;

app.use('/api/aacp', async (req, res) => {
  const path = req.url; // /api/aacp/products → /products
  const response = await fetch(`https://api.aacp.dev/v1${path}`, {
    method: req.method,
    headers: {
      'Authorization': `Bearer ${AACP_KEY}`,
      'Content-Type': 'application/json',
    },
    body: ['POST', 'PATCH', 'PUT'].includes(req.method) ? JSON.stringify(req.body) : undefined,
  });

  const data = await response.json();
  res.status(response.status).json(data);
});

app.listen(4000);
```

**React SPA (Vite)**
```typescript
// Your React app calls YOUR BFF, not AACP directly
const products = await fetch('http://localhost:4000/api/aacp/products');
```

**React Native**
```typescript
// Same pattern — call YOUR server
const orders = await fetch('https://your-bff.com/api/aacp/orders');
```

---

### Pattern D: Cloudflare Worker (Edge Proxy)

Zero infrastructure. Key stays in Cloudflare secrets.

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: { AACP_API_KEY: string }) {
    const url = new URL(request.url);
    const apiPath = url.pathname.replace('/api/', '/v1/');

    const response = await fetch(`https://api.aacp.dev${apiPath}${url.search}`, {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${env.AACP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: request.body,
    });

    return new Response(response.body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

---

## Anti-Patterns (NEVER DO THIS)

```typescript
// ❌ Key in client-side env var
const API_KEY = import.meta.env.VITE_AACP_KEY; // EXPOSED in bundle

// ❌ Key in React component
fetch('https://api.aacp.dev/v1/products', {
  headers: { Authorization: 'Bearer aacp_live_xxx' } // VISIBLE in DevTools
});

// ❌ Key in mobile app
const key = 'aacp_live_xxx'; // EXTRACTABLE from APK/IPA

// ❌ Key in public repo
// .env committed to git with real keys

// ❌ Key in localStorage/cookies
localStorage.setItem('apiKey', 'aacp_live_xxx'); // XSS = game over
```

---

## Key Rotation

If a key is compromised:

1. Dashboard → Settings → API Keys
2. Create new key with same scopes
3. Update your server environment variable
4. Revoke the old key
5. Old key returns `401 Unauthorized` immediately

**Best practice:** Rotate keys every 90 days. Use separate keys for staging vs production.

---

## Scopes (Principle of Least Privilege)

Don't grant all 31 scopes. Give each integration only what it needs:

| Integration | Scopes Needed |
|-------------|---------------|
| Product catalog display | `catalog:read` |
| Checkout flow | `checkout:read`, `checkout:write` |
| Order management | `orders:read`, `orders:write` |
| Analytics dashboard | `analytics:read` |
| Full admin | All scopes (owner only) |

---

## Environment Separation

| Key Prefix | Environment | Real transactions? |
|------------|-------------|-------------------|
| `aacp_test_*` | Sandbox | No — isolated test data |
| `aacp_live_*` | Production | Yes — real money |

**Never use `aacp_live_*` in development or CI/CD.**

---

## Summary

| Your Stack | Recommended Pattern |
|-----------|-------------------|
| Next.js / Nuxt / Remix | API Routes (Pattern A) |
| React SPA + Express | BFF proxy (Pattern C) |
| React Native / Flutter | BFF proxy (Pattern C) |
| Laravel / Django / Rails | Direct server-side (Pattern A) |
| Microservices / Scale | Kong API Gateway (Pattern B) |
| Edge / Serverless | Cloudflare Worker (Pattern D) |
| Any + Docker | Kong (Pattern B) |

**Golden rule:** API key lives on YOUR server. Client talks to YOUR server. Your server talks to AACP.
