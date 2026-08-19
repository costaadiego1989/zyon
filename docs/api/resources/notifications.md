# Notifications

Trigger transactional email/SMS notifications for order lifecycle events.

## Endpoints

### POST /v1/notifications/order-confirmation

Send an order confirmation notification to the customer.

**Auth:** `orders:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| order_id | string | Yes | Order ID |
| customer_email | string | Yes | Customer email address |
| customer_name | string | No | Customer display name |
| order_total | number | No | Order total in minor units |
| currency | string | No | Currency code |

**Response:**
```json
{
  "data": {
    "notification_type": "order_confirmation",
    "order_id": "order_456",
    "status": "sent",
    "sent_at": "2024-08-18T10:30:00Z"
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
curl -X POST https://api.aacp.dev/v1/notifications/order-confirmation \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "order_456",
    "customer_email": "john@example.com",
    "customer_name": "John Doe"
  }'
```

### POST /v1/notifications/order-shipped

Send a shipping notification to the customer.

**Auth:** `orders:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| order_id | string | Yes | Order ID |
| customer_email | string | Yes | Customer email address |
| customer_name | string | No | Customer display name |
| tracking_code | string | No | Shipment tracking code |
| carrier | string | No | Carrier name |
| estimated_delivery | string | No | Estimated delivery date |

**Response:**
```json
{
  "data": {
    "notification_type": "order_shipped",
    "order_id": "order_456",
    "status": "sent",
    "sent_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/notifications/order-delivered

Send an order delivered notification to the customer.

**Auth:** `orders:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| order_id | string | Yes | Order ID |
| customer_email | string | Yes | Customer email address |
| customer_name | string | No | Customer display name |
| delivered_at | string | No | Delivery timestamp |

**Response:**
```json
{
  "data": {
    "notification_type": "order_delivered",
    "order_id": "order_456",
    "status": "sent",
    "sent_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/notifications/return-approved

Notify the customer their return request was approved.

**Auth:** `orders:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| order_id | string | Yes | Order ID |
| customer_email | string | Yes | Customer email address |
| customer_name | string | No | Customer display name |
| return_id | string | No | Return request ID |
| refund_amount | number | No | Refund amount in minor units |

**Response:**
```json
{
  "data": {
    "notification_type": "return_approved",
    "order_id": "order_456",
    "status": "sent",
    "sent_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
