# Orders

Retrieve, manage, and track merchant orders from connected commerce platforms.

## Endpoints

### GET /v1/orders

List orders with cursor-based pagination.

**Auth:** `orders:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| limit | number | No | Page size (default 20, max 100) |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "data": [
    {
      "order_id": "order_123",
      "external_id": "shop_order_456",
      "customer_email": "john@example.com",
      "status": "completed",
      "total": 4990,
      "currency": "BRL",
      "items_count": 1,
      "created_at": "2024-08-18T10:30:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6ImRjYzY3OTc2In0=",
    "has_more": true
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/orders/:id

Get full order details with line items and status.

**Auth:** `orders:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Order ID |

**Response:**
```json
{
  "data": {
    "order_id": "order_123",
    "external_id": "shop_order_456",
    "status": "completed",
    "customer": {
      "email": "john@example.com",
      "name": "John Doe",
      "phone": "+5511999999999"
    },
    "items": [
      {
        "sku": "SKU-001",
        "name": "Product A",
        "quantity": 1,
        "price": 4990
      }
    ],
    "totals": {
      "subtotal": 4990,
      "shipping": 1500,
      "discount": 0,
      "tax": 0,
      "total": 6490
    },
    "currency": "BRL",
    "created_at": "2024-08-18T10:30:00Z",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/orders/:id/cancel

Cancel an order if allowed by commerce platform rules.

**Auth:** `orders:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| reason | string | No | Cancellation reason |
| notify_customer | boolean | No | Send notification to customer |
| restock | boolean | No | Restore items to inventory |

**Response:**
```json
{
  "data": {
    "order_id": "order_123",
    "status": "cancelled",
    "cancelled_at": "2024-08-18T10:35:00Z",
    "reason": "Customer request"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### GET /v1/orders/:id/tracking

Get tracking information for a shipped order.

**Auth:** `tracking:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Order ID |

**Response:**
```json
{
  "data": {
    "order_id": "order_123",
    "status": "shipped",
    "tracking_code": "BR123456789ABC",
    "carrier": "sedex",
    "estimated_delivery": "2024-08-25",
    "last_update": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### PATCH /v1/orders/:id/tracking

Update order status or tracking information.

**Auth:** `tracking:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | Yes | New order status |

**Response:**
```json
{
  "data": {
    "order_id": "order_123",
    "status": "delivered",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```
