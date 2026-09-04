# Support

Access support settings and ticket history.

## Endpoints

### GET /v1/support/settings

Get support channel configuration for the merchant.

**Auth:** `support:read`

**Response:**
```json
{
  "data": {
    "email": "support@mystore.com",
    "phone": "+5511999999999",
    "whatsapp": true,
    "whatsapp_number": "5511999999999",
    "support_hours": {
      "monday_friday": "09:00-18:00",
      "saturday": "09:00-13:00",
      "sunday": "closed"
    },
    "timezone": "America/Sao_Paulo",
    "average_response_time_minutes": 120
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### GET /v1/support/tickets

List support tickets for the merchant.

**Auth:** `support:read`

**Request:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status (open, in_progress, resolved, closed) |
| limit | number | No | Page size (default 50, max 200) |
| cursor | string | No | Pagination cursor |

**Response:**
```json
{
  "data": [
    {
      "ticket_id": "tkt_123",
      "subject": "Checkout widget not loading",
      "status": "in_progress",
      "priority": "high",
      "created_at": "2024-08-15T14:20:00Z",
      "last_updated_at": "2024-08-18T09:00:00Z",
      "assigned_to": "support@aacp.dev"
    }
  ],
  "pagination": {
    "next_cursor": "eyJpZCI6InRrdF8xMjMifQ==",
    "has_more": false
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
