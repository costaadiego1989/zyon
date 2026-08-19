# Settings

Configure checkout behavior, AI agent rules, store profile, and SEO metadata.

## Endpoints

### GET /v1/settings/checkout

Retrieve checkout widget configuration.

**Auth:** `configuration:read`

**Response:**
```json
{
  "data": {
    "widget_enabled": true,
    "trigger_delay_ms": 5000,
    "exit_intent_enabled": true,
    "idle_timeout_enabled": true,
    "idle_timeout_seconds": 30,
    "suppression_window_hours": 24,
    "max_sessions_per_day": 3,
    "allowed_pages": ["/checkout", "/cart"],
    "blocked_pages": ["/success"],
    "theme": "light",
    "position": "bottom-right",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**Headers:**
| Header | Description |
|--------|-------------|
| ETag | Entity version for optimistic concurrency |

### PUT /v1/settings/checkout

Update checkout widget configuration (optimistic concurrency via If-Match).

**Auth:** `configuration:write`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| If-Match | No | ETag for optimistic concurrency control |

**Request:**
Fields accepted mirror the GET response body. All fields are optional (partial patch semantics).

**Response:**
```json
{
  "data": {
    "widget_enabled": true,
    "trigger_delay_ms": 3000,
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### GET /v1/settings/agent-rules

Retrieve AI agent behavior rules and guardrails.

**Auth:** `configuration:read`

**Response:**
```json
{
  "data": {
    "identity": {
      "name": "Assistente de Compras",
      "personality": "friendly"
    },
    "capabilities": {
      "can_offer_discount": true,
      "can_offer_shipping_subsidy": true,
      "can_recommend_products": true
    },
    "guardrails": {
      "max_discount_percent": 25,
      "min_margin_percent": 15,
      "never_mention_competitors": true,
      "forbidden_topics": ["politics", "religion"]
    },
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PUT /v1/settings/agent-rules

Update AI agent behavior rules (optimistic concurrency via If-Match).

**Auth:** `configuration:write`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| If-Match | No | ETag for optimistic concurrency control |

**Request:**
Fields accepted mirror the GET response body. Partial updates supported.

**Response:**
```json
{
  "data": {
    "identity": { "..." },
    "capabilities": { "..." },
    "guardrails": { "..." },
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### GET /v1/settings/store

Retrieve store profile configuration.

**Auth:** `configuration:read`

**Response:**
```json
{
  "data": {
    "store_name": "My Store",
    "store_url": "https://mystore.com",
    "logo_url": "https://cdn.example.com/logo.png",
    "primary_color": "#4F46E5",
    "currency": "BRL",
    "locale": "pt-BR",
    "timezone": "America/Sao_Paulo",
    "contact_email": "support@mystore.com",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PUT /v1/settings/store

Update store profile configuration (optimistic concurrency via If-Match).

**Auth:** `configuration:write`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| If-Match | No | ETag for optimistic concurrency control |

**Request:**
Fields accepted mirror the GET response body. All fields are optional.

### GET /v1/settings/seo

Retrieve SEO configuration.

**Auth:** `configuration:read`

**Response:**
```json
{
  "data": {
    "meta_title": "My Store - Best Products",
    "meta_description": "Shop the best products at My Store",
    "og_title": "My Store",
    "og_description": "...",
    "og_image": "https://cdn.example.com/og.jpg",
    "twitter_card": "summary_large_image",
    "canonical_url": "https://mystore.com",
    "robots": "index, follow",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PUT /v1/settings/seo

Update SEO configuration (optimistic concurrency via If-Match).

**Auth:** `configuration:write`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| If-Match | No | ETag for optimistic concurrency control |

**Request:**
Fields accepted mirror the GET response body. All fields are optional.

**cURL Example:**
```bash
curl -X PUT https://api.aacp.dev/v1/settings/seo \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -H "If-Match: \"abc123\"" \
  -d '{
    "meta_title": "My Store - Best Products Online",
    "meta_description": "Find the best products at My Store"
  }'
```
