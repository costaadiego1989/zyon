# Domains

Register and manage custom domains for your storefront.

## Endpoints

### GET /v1/domains

List all registered custom domains for the merchant.

**Auth:** `configuration:read`

**Response:**
```json
{
  "data": [
    {
      "domain_id": "dom_123",
      "domain_name": "checkout.mystore.com",
      "status": "verified",
      "dns_records": [
        {
          "type": "CNAME",
          "name": "checkout.mystore.com",
          "value": "cname.aacp.dev",
          "verified": true
        }
      ],
      "verified_at": "2024-08-01T10:30:00Z",
      "created_at": "2024-07-31T10:30:00Z"
    }
  ],
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```

### POST /v1/domains

Register a new custom domain.

**Auth:** `configuration:read` (human principals only)

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| domain_name | string | Yes | Domain name to register |

**Response:**
```json
{
  "data": {
    "domain_id": "dom_new",
    "domain_name": "checkout.mystore.com",
    "status": "pending_verification",
    "dns_records": [
      {
        "type": "CNAME",
        "name": "checkout.mystore.com",
        "value": "cname.aacp.dev",
        "verified": false
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
curl -X POST https://api.aacp.dev/v1/domains \
  -H "Authorization: Bearer aacp_test_..." \
  -H "Content-Type: application/json" \
  -d '{
    "domain_name": "checkout.mystore.com"
  }'
```

### POST /v1/domains/:id/verify

Verify a domain registration by checking DNS records.

**Auth:** `configuration:read` (human principals only)

**Response:**
```json
{
  "data": {
    "domain_id": "dom_123",
    "domain_name": "checkout.mystore.com",
    "status": "verified",
    "dns_records": [
      {
        "type": "CNAME",
        "name": "checkout.mystore.com",
        "value": "cname.aacp.dev",
        "verified": true
      }
    ],
    "verified_at": "2024-08-18T10:30:00Z"
  },
  "meta": {
    "request_id": "req_123",
    "timestamp": "2024-08-18T10:30:00Z",
    "version": "v1"
  }
}
```
