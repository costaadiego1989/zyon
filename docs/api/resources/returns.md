# Returns

Request and track product returns for completed orders.

## Endpoints

### GET /v1/returns

List return requests with cursor-based pagination and filtering.

**Auth:** `returns:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| limit | number | No | Page size (default 20, max 100) |
| cursor | string | No | Pagination cursor |
| status | string | No | Filter by status (pending, approved, rejected, completed) |

**Response:**
```json
{
  "data": [
    {
      "return_id": "ret_123",
      "order_id": "order_456",
      "buyer_id": "buyer_789",
      "status": "pending",
      "reason": "Product defect",
      "items": [
        {
          "sku": "SKU-001",
          "quantity": 1,
          "reason": "Defective"
        }
      ],
      "created_at": "2024-08-15T14:20:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6InJldF8xMjMifQ==",
    "has_more": true
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/returns

Request a return for an order.

**Auth:** `returns:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| order_id | string | Yes | Order ID to return |
| reason | string | Yes | Return reason |
| items | array | Yes | Items to return |
| items[].sku | string | Yes | Product SKU |
| items[].quantity | number | Yes | Quantity to return |
| items[].reason | string | No | Per-item reason |

**Response:**
```json
{
  "data": {
    "return_id": "ret_new",
    "order_id": "order_456",
    "status": "pending",
    "reason": "Product defect",
    "items": [
      {
        "sku": "SKU-001",
        "quantity": 1,
        "reason": "Defective"
      }
    ],
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
curl -X POST https://api.aacp.dev/v1/returns \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "order_456",
    "reason": "Product defect",
    "items": [
      {
        "sku": "SKU-001",
        "quantity": 1,
        "reason": "Defective"
      }
    ]
  }'
```
