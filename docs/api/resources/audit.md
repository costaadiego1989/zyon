# Audit

View audit trail events for compliance and monitoring.

## Endpoints

### GET /v1/audit-events

List audit events with filtering and cursor-based pagination.

**Auth:** `audit:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | No | Filter by action (e.g., checkout_created) |
| resource_type | string | No | Filter by resource type (e.g., checkout, order) |
| actor_id | string | No | Filter by actor (user ID) |
| date_from | string | No | Start date (ISO 8601, e.g., 2024-08-01) |
| date_to | string | No | End date (ISO 8601, e.g., 2024-08-31) |
| cursor | string | No | Pagination cursor |
| limit | number | No | Page size (default 50, max 100) |

**Response:**
```json
{
  "data": [
    {
      "event_id": "audit_123",
      "action": "checkout_created",
      "resource_type": "checkout",
      "resource_id": "sess_abc123",
      "actor_id": "usr_456",
      "actor_type": "user",
      "ip_address": "192.168.1.1",
      "metadata": {
        "items_count": 2,
        "cart_total": 9990
      },
      "created_at": "2024-08-18T10:30:00Z"
    },
    {
      "event_id": "audit_124",
      "action": "order_cancelled",
      "resource_type": "order",
      "resource_id": "order_456",
      "actor_id": "usr_789",
      "actor_type": "service",
      "metadata": {
        "reason": "Customer request"
      },
      "created_at": "2024-08-18T09:15:00Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6ImF1ZGl0XzEyNCJ9",
    "has_more": true
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
curl -X GET "https://api.aacp.dev/v1/audit-events?resource_type=checkout&date_from=2024-08-01&limit=25" \
  -H "Authorization: Bearer aacp_test_..."
```
