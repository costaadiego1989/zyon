# Installations

Manage widget installations (environments, allowed origins, API keys).

## Endpoints

### GET /v1/installations

List all widget installations for the merchant.

**Auth:** `installations:read`

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
      "id": "inst_abc123",
      "name": "Production Store",
      "environment": "live",
      "status": "active",
      "widget_version": "1.0.0",
      "allowed_origins": ["https://mystore.com", "https://www.mystore.com"],
      "api_key_hint": "aacp_live_...xyz",
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

### GET /v1/installations/:id

Get installation details.

**Auth:** `installations:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Installation ID |

**Response:**
```json
{
  "data": {
    "id": "inst_abc123",
    "name": "Production Store",
    "environment": "live",
    "status": "active",
    "widget_version": "1.0.0",
    "allowed_origins": ["https://mystore.com"],
    "api_key_hint": "aacp_live_...xyz",
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

**Headers:**
| Header | Description |
|--------|-------------|
| ETag | Entity version for optimistic concurrency |

### POST /v1/installations

Create a new widget installation.

**Auth:** `installations:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Installation name |
| environment | string | No | Environment (test, live). Default: live |
| widget_version | string | No | Widget version. Default: 1.0.0 |
| allowed_origins | string[] | Yes | Allowed origins for CORS |

**Response:**
```json
{
  "data": {
    "id": "inst_new",
    "name": "Staging Store",
    "environment": "test",
    "status": "active",
    "widget_version": "1.0.0",
    "allowed_origins": ["https://staging.mystore.com"],
    "api_key": "aacp_test_full_key_here",
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
curl -X POST https://api.aacp.dev/v1/installations \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Staging Store",
    "environment": "test",
    "allowed_origins": ["https://staging.mystore.com"]
  }'
```

### PATCH /v1/installations/:id

Update an installation (name, origins, widget version).

**Auth:** `installations:write`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| If-Match | No | ETag for optimistic concurrency |

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | No | Installation name |
| widget_version | string | No | Widget version |
| allowed_origins | string[] | No | Updated allowed origins |
| status | string | No | Status (active, disabled) |

**Response:**
```json
{
  "data": {
    "id": "inst_abc123",
    "name": "Production Store v2",
    "status": "active",
    "widget_version": "2.0.0",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/installations/:id

Delete (disable) a widget installation.

**Auth:** `installations:write`

**Response:** `204 No Content`
