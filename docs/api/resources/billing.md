# Billing

View and manage subscription plans, billing usage, and invoices (human-only).

## Endpoints

### GET /v1/billing/plans

List available billing plans.

**Auth:** `humanOnly` (human principals only)

**Response:**
```json
{
  "data": [
    {
      "plan_id": "plan_starter",
      "name": "Starter",
      "description": "Perfect for getting started",
      "price_monthly_brl": 9900,
      "currency": "BRL",
      "features": [
        "Up to 100 orders/month",
        "Basic analytics",
        "1 team member"
      ],
      "limits": {
        "orders_per_month": 100,
        "team_members": 1,
        "webhook_endpoints": 5
      }
    },
    {
      "plan_id": "plan_professional",
      "name": "Professional",
      "description": "For growing businesses",
      "price_monthly_brl": 29900,
      "currency": "BRL",
      "features": [
        "Up to 1000 orders/month",
        "Advanced analytics",
        "Up to 10 team members"
      ],
      "limits": {
        "orders_per_month": 1000,
        "team_members": 10,
        "webhook_endpoints": 25
      }
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/billing/subscription

Get current subscription details for the merchant.

**Auth:** `humanOnly` (human principals only)

**Response:**
```json
{
  "data": {
    "plan": "professional",
    "plan_name": "Professional",
    "monthly_price_brl": 29900,
    "transaction_fee_percent": 2.5,
    "limits": {
      "orders_per_month": 1000,
      "sessions_per_month": 5000,
      "ai_conversations_per_month": 10000,
      "team_members": 10,
      "webhook_endpoints": 25
    },
    "features": [
      "AI-powered checkout",
      "Advanced analytics",
      "Team collaboration"
    ],
    "status": "active",
    "trial_end": null,
    "current_period_end": "2024-09-18",
    "cancel_at_period_end": false,
    "has_billing_customer": true,
    "has_subscription": true,
    "usage": {
      "period_start": "2024-08-18",
      "orders_current": 245,
      "orders_limit": 1000,
      "sessions_current": 1200,
      "sessions_limit": 5000,
      "ai_conversations_current": 3400,
      "ai_conversations_limit": 10000,
      "team_members_current": 3,
      "team_members_limit": 10,
      "webhook_endpoints_current": 5,
      "webhook_endpoints_limit": 25
    },
    "created_at": "2024-06-01T10:30:00Z",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/billing/subscription/change

Upgrade, downgrade, or change the subscription plan.

**Auth:** `humanOnly` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| plan_id | string | Yes | Target plan ID |
| effective_date | string | No | When to apply the change (ISO 8601) |

**Response:**
```json
{
  "data": {
    "plan": "starter",
    "monthly_price_brl": 9900,
    "status": "change_scheduled",
    "effective_date": "2024-09-18",
    "updated_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/billing/usage

Get current usage metrics for the billing period.

**Auth:** `humanOnly` (human principals only)

**Response:**
```json
{
  "data": {
    "period": {
      "start": "2024-08-18",
      "end": "2024-09-18"
    },
    "metrics": {
      "orders": {
        "current": 245,
        "limit": 1000,
        "percentage": 24.5
      },
      "sessions": {
        "current": 1200,
        "limit": 5000,
        "percentage": 24.0
      },
      "ai_conversations": {
        "current": 3400,
        "limit": 10000,
        "percentage": 34.0
      },
      "team_members": {
        "current": 3,
        "limit": 10,
        "percentage": 30.0
      },
      "webhook_endpoints": {
        "current": 5,
        "limit": 25,
        "percentage": 20.0
      }
    },
    "estimated_overage_charges": 0
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/billing/invoices

Get billing invoices for the merchant.

**Auth:** `humanOnly` (human principals only)

**Response:**
```json
{
  "data": [
    {
      "invoice_id": "inv_123",
      "date": "2024-08-18",
      "period_start": "2024-08-01",
      "period_end": "2024-08-31",
      "plan": "professional",
      "subtotal": 29900,
      "tax": 0,
      "total": 29900,
      "currency": "BRL",
      "status": "paid",
      "pdf_url": "https://billing.aacp.dev/invoices/inv_123.pdf",
      "paid_at": "2024-08-18T10:30:00Z"
    },
    {
      "invoice_id": "inv_122",
      "date": "2024-07-18",
      "period_start": "2024-07-01",
      "period_end": "2024-07-31",
      "plan": "professional",
      "subtotal": 29900,
      "tax": 0,
      "total": 29900,
      "currency": "BRL",
      "status": "paid",
      "pdf_url": "https://billing.aacp.dev/invoices/inv_122.pdf",
      "paid_at": "2024-07-18T10:30:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
