# Webhooks

Manage webhook endpoints to receive real-time event notifications from your AACP account.

## Endpoints

### GET /v1/webhooks

List all webhook endpoints for the merchant.

**Auth:** `webhooks:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| limit | number | No | Page size (default 20) |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "data": [
    {
      "id": "wh_abc123",
      "url": "https://erp.example.com/webhooks/aacp",
      "active": true,
      "events": ["checkout.completed", "order.created"],
      "description": "ERP integration",
      "secret_key_hint": "whsec_...xyz",
      "created_at": "2024-08-01T10:30:00Z",
      "updated_at": "2024-08-18T10:30:00Z"
    }
  ],
  "pagination": {
    "next_cursor": null,
    "has_more": false
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/webhooks/:id

Get a single webhook endpoint with full details.

**Auth:** `webhooks:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Webhook endpoint ID |

**Response:**
```json
{
  "data": {
    "id": "wh_abc123",
    "url": "https://erp.example.com/webhooks/aacp",
    "active": true,
    "events": ["checkout.completed", "order.created"],
    "description": "ERP integration",
    "secret_key_hint": "whsec_...xyz",
    "created_at": "2024-08-01T10:30:00Z",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/webhooks

Create a new webhook endpoint.

**Auth:** `webhooks:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | HTTPS webhook URL |
| events | string[] | No | Event types to subscribe (all if omitted) |
| active | boolean | No | Enable/disable (default true) |
| description | string | No | Human-readable description (max 240 chars) |

**Response:**
```json
{
  "data": {
    "id": "wh_new123",
    "url": "https://erp.example.com/webhooks/aacp",
    "active": true,
    "events": ["checkout.completed"],
    "description": "New integration",
    "secret_key": "whsec_live_abcdef123456",
    "secret_key_hint": "whsec_...456",
    "created_at": "2024-08-18T10:30:00Z",
    "updated_at": "2024-08-18T10:30:00Z"
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
curl -X POST https://api.aacp.dev/v1/webhooks \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://erp.example.com/webhooks/aacp",
    "events": ["checkout.completed", "order.created"],
    "description": "ERP integration"
  }'
```

### PUT /v1/webhooks/:id

Update an existing webhook endpoint (full replacement).

**Auth:** `webhooks:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | HTTPS webhook URL |
| events | string[] | No | Event types |
| active | boolean | No | Enable/disable |
| description | string | No | Description (max 240 chars) |

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| If-Match | No | ETag for optimistic concurrency |

**Response:**
```json
{
  "data": {
    "id": "wh_abc123",
    "url": "https://erp.example.com/webhooks/aacp-v2",
    "active": true,
    "events": ["checkout.completed", "order.created", "order.cancelled"],
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/webhooks/:id

Delete a webhook endpoint permanently.

**Auth:** `webhooks:write`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Webhook endpoint ID |

**Response:** `204 No Content`

### POST /v1/webhooks/:id/test

Send a test payload to verify the endpoint is reachable.

**Auth:** `webhooks:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| event_type | string | No | Specific event type to simulate |

**Response:**
```json
{
  "data": {
    "id": "dlv_test123",
    "webhook_id": "wh_abc123",
    "webhook_url": "https://erp.example.com/webhooks/aacp",
    "event_id": "evt_test123",
    "event_type": "checkout.completed",
    "status": "delivered",
    "attempts": 1,
    "response_status": 200,
    "delivered_at": "2024-08-18T10:30:05Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
