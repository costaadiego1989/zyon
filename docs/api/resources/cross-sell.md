# Cross-Sell

Create cross-sell promotions and retrieve eligible suggestions for active sessions.

## Endpoints

### GET /v1/cross-sells

List all cross-sell promotions for the merchant.

**Auth:** `checkout:read`

**Response:**
```json
{
  "data": [
    {
      "promotion_id": "xsell_123",
      "name": "Buy Shoes Get Socks",
      "trigger": {
        "type": "cart_contains",
        "skus": ["SHOE-001", "SHOE-002"]
      },
      "recommended_skus": ["SOCK-001", "SOCK-002"],
      "discount_percent": 20,
      "max_discount_percent": 30,
      "status": "active",
      "starts_at": "2024-08-01T00:00:00Z",
      "ends_at": "2024-12-31T23:59:59Z",
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

### POST /v1/cross-sells

Create a new cross-sell promotion.

**Auth:** `checkout:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Promotion name |
| trigger | object | Yes | Trigger conditions |
| trigger.type | string | Yes | Trigger type (cart_contains, etc.) |
| trigger.skus | string[] | No | Trigger SKUs |
| recommended_skus | string[] | Yes | SKUs to recommend |
| discount_percent | number | No | Base discount percentage |
| max_discount_percent | number | No | Maximum discount cap |
| starts_at | string | Yes | Start date (ISO 8601) |
| ends_at | string | No | End date (ISO 8601) |

**Response:**
```json
{
  "data": {
    "promotion_id": "xsell_new",
    "name": "Buy Shoes Get Socks",
    "status": "active",
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
curl -X POST https://api.aacp.dev/v1/cross-sells \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Buy Shoes Get Socks",
    "trigger": {
      "type": "cart_contains",
      "skus": ["SHOE-001"]
    },
    "recommended_skus": ["SOCK-001", "SOCK-002"],
    "discount_percent": 20,
    "starts_at": "2024-08-01T00:00:00Z"
  }'
```

### GET /v1/cross-sells/eligible

Get eligible cross-sell suggestions for a checkout session and cart.

**Auth:** `checkout:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| session_id | string (query) | Yes | Active checkout session ID |
| cart | string (query) | No | JSON-encoded cart object |

**Response:**
```json
{
  "data": [
    {
      "promotion_id": "xsell_123",
      "name": "Buy Shoes Get Socks",
      "recommended_products": [
        {
          "sku": "SOCK-001",
          "name": "Premium Socks",
          "price": 2990,
          "discount_price": 2392,
          "discount_percent": 20
        }
      ]
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
