# Customers

Access customer profile information and purchase history.

## Endpoints

### GET /v1/customers

List customers for the merchant with pagination.

**Auth:** `customers:read`

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
      "customer_id": "cust_123",
      "email": "john@example.com",
      "name": "John Doe",
      "phone": "+5511999999999",
      "cpf": "123.456.789-00",
      "total_orders": 5,
      "total_spent": 24950,
      "currency": "BRL",
      "created_at": "2024-07-01T10:30:00Z",
      "last_order_at": "2024-08-18T10:30:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6ImN1c3RfMTIzIn0=",
    "has_more": true
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/customers/:id

Get detailed customer profile.

**Auth:** `customers:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Customer ID |

**Response:**
```json
{
  "data": {
    "customer_id": "cust_123",
    "email": "john@example.com",
    "name": "John Doe",
    "phone": "+5511999999999",
    "cpf": "123.456.789-00",
    "address": {
      "street": "Rua das Flores, 123",
      "city": "São Paulo",
      "state": "SP",
      "zip": "01310-100",
      "country": "BR"
    },
    "total_orders": 5,
    "total_spent": 24950,
    "currency": "BRL",
    "created_at": "2024-07-01T10:30:00Z",
    "last_order_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/customers/:id/orders

Get order history for a customer.

**Auth:** `customers:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Customer ID |
| limit | number | No | Page size (default 20, max 100) |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "data": [
    {
      "order_id": "order_456",
      "status": "completed",
      "total": 9990,
      "currency": "BRL",
      "items_count": 2,
      "created_at": "2024-08-15T14:20:00Z"
    },
    {
      "order_id": "order_123",
      "status": "completed",
      "total": 4990,
      "currency": "BRL",
      "items_count": 1,
      "created_at": "2024-08-10T10:30:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6Im9yZGVyXzEyMyJ9",
    "has_more": false
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
