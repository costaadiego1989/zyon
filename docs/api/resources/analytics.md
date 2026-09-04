# Analytics

Track and measure checkout performance, offers ROI, payment metrics, and customer behavior.

## Endpoints

### GET /v1/analytics/dashboard

Get high-level dashboard metrics for the current period.

**Auth:** `analytics:read`

**Response:**
```json
{
  "data": {
    "period": {
      "from": "2024-08-01",
      "to": "2024-08-31"
    },
    "sessions": {
      "total": 5000,
      "completed": 1200,
      "abandoned": 3800,
      "completion_rate": 24.0
    },
    "revenue": {
      "total": 599400,
      "currency": "BRL",
      "average_order": 49950
    },
    "offers": {
      "total_generated": 2500,
      "accepted": 800,
      "acceptance_rate": 32.0
    },
    "top_objections": [
      {
        "objection": "High shipping cost",
        "frequency": 1200
      }
    ]
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/analytics/products

Get product-level performance metrics.

**Auth:** `analytics:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| date_from | string | No | Start date (ISO 8601) |
| date_to | string | No | End date (ISO 8601) |
| product_id | string | No | Filter by product |

**Response:**
```json
{
  "data": [
    {
      "product_id": "prod_123",
      "name": "Product A",
      "sku": "SKU-001",
      "units_sold": 150,
      "revenue": 74850,
      "average_price": 49900,
      "cart_additions": 450,
      "cart_abandonment": 300
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/analytics/products/:id

Get detailed analytics for a single product.

**Auth:** `analytics:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| id | string (path) | Yes | Product ID |
| date_from | string | No | Start date (ISO 8601) |
| date_to | string | No | End date (ISO 8601) |

**Response:**
```json
{
  "data": {
    "product_id": "prod_123",
    "name": "Product A",
    "sku": "SKU-001",
    "units_sold": 150,
    "revenue": 74850,
    "average_price": 49900,
    "cart_additions": 450,
    "cart_abandonment": 300,
    "abandonment_rate": 66.67,
    "average_rating": 4.5
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/analytics/offers/roi

Measure return on investment for generated offers.

**Auth:** `analytics:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| date_from | string | No | Start date (ISO 8601) |
| date_to | string | No | End date (ISO 8601) |
| offer_id | string | No | Filter by offer |

**Response:**
```json
{
  "data": {
    "period": {
      "from": "2024-08-01",
      "to": "2024-08-31"
    },
    "total_offers_generated": 2500,
    "total_offers_accepted": 800,
    "acceptance_rate": 32.0,
    "revenue_attributed": 159800,
    "discount_cost": 15980,
    "net_revenue": 143820,
    "roi": 900.0,
    "top_offer": {
      "id": "offer_abc",
      "description": "15% off",
      "acceptance_rate": 45.0,
      "conversions": 225
    }
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/analytics/payments

Get payment method distribution and transaction metrics.

**Auth:** `analytics:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| date_from | string | No | Start date (ISO 8601) |
| date_to | string | No | End date (ISO 8601) |

**Response:**
```json
{
  "data": {
    "total_transactions": 1200,
    "total_volume": 599400,
    "methods": [
      {
        "method": "credit_card",
        "transactions": 600,
        "volume": 350000,
        "average_transaction": 58333,
        "success_rate": 95.5
      },
      {
        "method": "pix",
        "transactions": 400,
        "volume": 200000,
        "average_transaction": 50000,
        "success_rate": 98.0
      }
    ],
    "declined_rate": 2.5,
    "chargeback_rate": 0.3
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/analytics/customers

Get customer acquisition and retention metrics.

**Auth:** `analytics:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| date_from | string | No | Start date (ISO 8601) |
| date_to | string | No | End date (ISO 8601) |

**Response:**
```json
{
  "data": {
    "new_customers": 450,
    "repeat_customers": 175,
    "total_customers": 625,
    "repeat_rate": 28.0,
    "average_ltv": 958.24,
    "average_order_value": 959.04,
    "customer_retention": 45.0,
    "churn_rate": 55.0
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
