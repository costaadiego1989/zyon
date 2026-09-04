# Fulfillment

Create and track shipments for orders.

## Endpoints

### GET /v1/fulfillment/shipments

List shipments for the merchant with cursor-based pagination.

**Auth:** `tracking:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| limit | number | No | Page size (default 20, max 100) |
| cursor | string | No | Pagination cursor |
| order_id | string | No | Filter by order ID |
| status | string | No | Filter by status (pending, shipped, delivered, cancelled) |

**Response:**
```json
{
  "data": [
    {
      "shipment_id": "shp_123",
      "order_id": "order_456",
      "carrier": "sedex",
      "tracking_code": "BR123456789ABC",
      "status": "shipped",
      "estimated_delivery": "2024-08-25",
      "created_at": "2024-08-18T10:30:00Z",
      "shipped_at": "2024-08-18T14:00:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6InNoaXBfMTIzIn0=",
    "has_more": false
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/fulfillment/shipments

Create a new shipment for an order.

**Auth:** `tracking:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| order_id | string | Yes | Order ID |
| carrier | string | Yes | Carrier key (sedex, pac, etc) |

**Response:**
```json
{
  "data": {
    "shipment_id": "shp_new",
    "order_id": "order_456",
    "carrier": "sedex",
    "tracking_code": "BR987654321XYZ",
    "status": "pending",
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
curl -X POST https://api.aacp.dev/v1/fulfillment/shipments \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "order_456",
    "carrier": "sedex"
  }'
```
