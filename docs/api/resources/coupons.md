# Coupons

Create and manage discount coupons with flexible rules and validation.

## Endpoints

### GET /v1/coupons

List all active coupons for the merchant.

**Auth:** `coupons:read`

**Response:**
```json
{
  "data": [
    {
      "id": "coup_123",
      "code": "SUMMER2024",
      "merchant_id": "merch_xyz",
      "discount_type": "percentage",
      "discount_value": 15,
      "min_cart_total": 10000,
      "max_usages": 100,
      "max_per_buyer": 1,
      "usages_count": 25,
      "allowed_skus": ["SKU-001", "SKU-002"],
      "blocked_skus": [],
      "allowed_regions": ["BR"],
      "blocked_regions": [],
      "status": "active",
      "starts_at": "2024-08-01T00:00:00Z",
      "ends_at": "2024-08-31T23:59:59Z",
      "created_at": "2024-08-01T10:30:00Z",
      "updated_at": "2024-08-18T10:30:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/coupons

Create a new coupon.

**Auth:** `coupons:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes | Unique coupon code |
| discount_type | string | Yes | `percentage` or `fixed` |
| discount_value | number | Yes | Discount amount or % |
| min_cart_total | number | No | Minimum cart value (cents) |
| max_usages | number | No | Total usage limit |
| max_per_buyer | number | No | Usage limit per buyer |
| allowed_skus | string[] | No | Restrict to SKUs |
| blocked_skus | string[] | No | Exclude SKUs |
| allowed_regions | string[] | No | Allowed regions/countries |
| blocked_regions | string[] | No | Blocked regions/countries |
| starts_at | string | No | Start date (ISO 8601) |
| ends_at | string | No | End date (ISO 8601) |
| experiment_id | string | No | Link to A/B experiment |

**Response:**
```json
{
  "data": {
    "id": "coup_abc",
    "code": "NEWYEAR2025",
    "discount_type": "percentage",
    "discount_value": 20,
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
curl -X POST https://api.aacp.dev/v1/coupons \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "code": "SUMMER25",
    "discount_type": "percentage",
    "discount_value": 15,
    "min_cart_total": 5000,
    "starts_at": "2025-06-01T00:00:00Z",
    "ends_at": "2025-08-31T23:59:59Z"
  }'
```

### PATCH /v1/coupons/:id

Archive or update a coupon (currently supports archiving only).

**Auth:** `coupons:write`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Set to `archived` to archive |

**Response:**
```json
{
  "data": {
    "id": "coup_123",
    "code": "SUMMER2024",
    "status": "archived",
    "updated_at": "2024-08-18T10:35:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:35:00Z",
    "version": "v1"
  }
}
```

### DELETE /v1/coupons/:id

Archive a coupon (logical delete, not permanent).

**Auth:** `coupons:write`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Coupon ID |

**Response:**
```json
{
  "data": {
    "archived": true,
    "coupon_id": "coup_123"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/coupons/:id/validate

Validate a coupon code for a cart (check eligibility and discount).

**Auth:** `coupons:read`

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes | Coupon code to validate |

**Response:**
```json
{
  "data": {
    "valid": true,
    "discount_value": 1500,
    "discount_type": "percentage"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

**Invalid coupon response:**
```json
{
  "data": {
    "valid": false,
    "reason": "Coupon has expired"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
