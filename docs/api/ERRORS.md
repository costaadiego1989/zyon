# Error Reference

The AACP API uses [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807) for all error responses. Errors are not wrapped in the standard response envelope — they replace it entirely.

## Error Schema

```json
{
  "type": "https://api.aacp.dev/errors/{error_code}",
  "title": "Human-Readable Title",
  "status": 422,
  "detail": "Specific description of what went wrong.",
  "instance": "/v1/checkouts",
  "errors": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | URI identifying the error type (stable, machine-readable) |
| `title` | string | Short human-readable summary |
| `status` | number | HTTP status code |
| `detail` | string | Specific explanation for this occurrence |
| `instance` | string | The request path that triggered the error |
| `errors` | array | Field-level validation errors (only for 422) |

---

## Common Error Codes

### 401 Unauthorized

Missing, invalid, or expired credentials.

```bash
curl https://api.aacp.dev/v1/orders \
  -H "Authorization: Bearer aacp_live_invalid_key"
```

```json
{
  "type": "https://api.aacp.dev/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "The provided API key is invalid or has been revoked.",
  "instance": "/v1/orders"
}
```

**Common causes:**
- API key not provided
- Key has been revoked or expired
- Using a `test` key against live resources (or vice versa)
- Malformed `Authorization` header

---

### 403 Forbidden

Valid credentials, but the key lacks the required scope or the action is restricted.

```json
{
  "type": "https://api.aacp.dev/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "API key does not have the required scope: orders:write",
  "instance": "/v1/orders/ord_123/cancel"
}
```

**Common causes:**
- Key missing the required scope (e.g., `orders:write` for canceling an order)
- Attempting a human-only action with a service API key
- Accessing a resource belonging to a different merchant

---

### 404 Not Found

The requested resource does not exist or is not accessible to the authenticated merchant.

```json
{
  "type": "https://api.aacp.dev/errors/not_found",
  "title": "Not Found",
  "status": 404,
  "detail": "Order ord_nonexistent does not exist.",
  "instance": "/v1/orders/ord_nonexistent"
}
```

**Note:** For security, resources belonging to other merchants return 404, not 403.

---

### 409 Conflict

The request conflicts with the current state of the resource, or an idempotency key mismatch was detected.

#### State Conflict

```json
{
  "type": "https://api.aacp.dev/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "Order ord_123 is already cancelled and cannot be cancelled again.",
  "instance": "/v1/orders/ord_123/cancel"
}
```

#### Idempotency Key Conflict

Occurs when the same `Idempotency-Key` is reused with a different request body:

```json
{
  "type": "https://api.aacp.dev/errors/idempotency_conflict",
  "title": "Idempotency Conflict",
  "status": 409,
  "detail": "A different request was already processed with this Idempotency-Key. Keys cannot be reused across different request bodies.",
  "instance": "/v1/checkouts"
}
```

**Resolution:** Use a new, unique `Idempotency-Key` value for the different request.

---

### 422 Unprocessable Entity

The request body failed validation. The `errors` array contains field-level details.

```bash
curl -X POST https://api.aacp.dev/v1/checkouts \
  -H "Authorization: Bearer $AACP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_url": "not-a-url",
    "product_price": -100
  }'
```

```json
{
  "type": "https://api.aacp.dev/errors/validation_error",
  "title": "Validation Error",
  "status": 422,
  "detail": "One or more fields failed validation.",
  "instance": "/v1/checkouts",
  "errors": [
    {
      "field": "product_url",
      "message": "must be a valid URL",
      "code": "invalid_format"
    },
    {
      "field": "product_price",
      "message": "must be a positive integer",
      "code": "invalid_range"
    },
    {
      "field": "product_name",
      "message": "is required",
      "code": "required"
    }
  ]
}
```

#### Validation Error Codes

| Code | Meaning |
|------|---------|
| `required` | Field is missing but required |
| `invalid_format` | Value does not match expected format |
| `invalid_range` | Numeric value out of allowed range |
| `invalid_length` | String length outside min/max bounds |
| `invalid_enum` | Value not in allowed set |
| `invalid_type` | Wrong data type |

---

### 429 Too Many Requests

Rate limit exceeded. The response includes a `Retry-After` header.

```json
{
  "type": "https://api.aacp.dev/errors/rate_limited",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded. Retry after 12 seconds.",
  "instance": "/v1/orders"
}
```

**Headers included:**

```
Retry-After: 12
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1723987712
```

**Handling:** Wait for the `Retry-After` duration before retrying. Implement exponential backoff for sustained throttling.

---

### 500 Internal Server Error

An unexpected server error occurred. These are logged and investigated automatically.

```json
{
  "type": "https://api.aacp.dev/errors/internal_error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unexpected error occurred. If this persists, contact support with the request_id.",
  "instance": "/v1/checkouts/chk_abc123/complete"
}
```

**Handling:**
- Retry with exponential backoff (max 3 retries).
- Use the `Idempotency-Key` header on mutations to safely retry.
- If persistent, contact support with the `request_id` from the `meta` field (available in 5xx responses when possible).

---

## Error Handling Best Practices

1. **Always check the HTTP status code first** — do not rely on response body parsing for control flow.
2. **Use `type` for programmatic handling** — it is stable and machine-readable.
3. **Log `request_id`** from `meta` — it enables faster support resolution.
4. **Idempotency keys on all mutations** — enables safe retries on 5xx errors.
5. **Implement exponential backoff** — for 429 and 5xx responses.
6. **Surface `detail` to developers** — it contains actionable information.
7. **Surface `errors[].message` to end users** — for 422 validation failures.
