# Commerce

Connect and manage commerce platform integrations (WooCommerce, Magento, VTEX).

## Endpoints

### GET /v1/commerce/connections

List all commerce platform connections for the merchant.

**Auth:** `commerce:read`

**Response:**
```json
{
  "data": [
    {
      "connection_id": "woo_123",
      "platform": "woocommerce",
      "status": "active",
      "store_name": "My WooCommerce Store",
      "store_url": "https://mystore.com",
      "products_synced": 450,
      "orders_synced": 1200,
      "last_sync_at": "2024-08-18T10:00:00Z",
      "created_at": "2024-08-01T10:30:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/commerce/connections

Connect a new commerce platform.

**Auth:** `commerce:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| platform | string | Yes | Platform name (woocommerce, magento, vtex) |
| credentials | object | Yes | Platform-specific credentials |

**WooCommerce Credentials:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| store_url | string | Yes | Store URL |
| consumer_key | string | Yes | WooCommerce API key |
| consumer_secret | string | Yes | WooCommerce API secret |
| webhook_secret | string | No | Webhook signing secret |

**Magento Credentials:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| base_url | string | Yes | Magento base URL |
| access_token | string | Yes | Access token |
| store_code | string | No | Store code |

**VTEX Credentials:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| account_name | string | Yes | VTEX account name |
| app_key | string | Yes | App key |
| app_token | string | Yes | App token |

**Response:**
```json
{
  "data": {
    "connection_id": "woo_new",
    "platform": "woocommerce",
    "status": "connected",
    "store_name": "My WooCommerce Store",
    "store_url": "https://mystore.com",
    "products_synced": 0,
    "created_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**cURL Example:**
```bash
curl -X POST https://api.aacp.dev/v1/commerce/connections \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "woocommerce",
    "credentials": {
      "store_url": "https://mystore.com",
      "consumer_key": "ck_...",
      "consumer_secret": "cs_..."
    }
  }'
```

### GET /v1/commerce/connections/:id

Get details for a specific commerce connection.

**Auth:** `commerce:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Connection ID |

**Response:**
```json
{
  "data": {
    "connection_id": "woo_123",
    "platform": "woocommerce",
    "status": "active",
    "store_name": "My WooCommerce Store",
    "store_url": "https://mystore.com",
    "products_synced": 450,
    "orders_synced": 1200,
    "last_sync_at": "2024-08-18T10:00:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PATCH /v1/commerce/connections/:id

Update connection credentials or settings.

**Auth:** `commerce:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| credentials | object | No | Updated credentials |

**Response:**
```json
{
  "data": {
    "connection_id": "woo_123",
    "platform": "woocommerce",
    "status": "active",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/commerce/connections/:id

Disconnect a commerce platform.

**Auth:** `commerce:write`

**Response:** `204 No Content`

### POST /v1/commerce/connections/:id/sync

Manually trigger a full sync of products and orders.

**Auth:** `commerce:write`

**Response:**
```json
{
  "data": {
    "connection_id": "woo_123",
    "sync_id": "sync_abc123",
    "status": "started",
    "started_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**Supported Platforms:**

**WooCommerce:** Syncs products, orders, customers, and inventory. Webhooks available for real-time updates.

**Magento:** Supports Magento 2.3+ with REST API. Syncs products, orders, and customer data.

**VTEX:** Integrates with VTEX platform. Syncs products and orders via VTEX API.
