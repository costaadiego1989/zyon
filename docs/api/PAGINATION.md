# Pagination

List endpoints use **cursor-based pagination** for safe traversal of large datasets.

## Why Cursor-Based Pagination?

Offset-based pagination breaks when data is mutated between requests (items shift). Cursor-based pagination is immutable — the cursor encodes the position, ensuring consistent results even as new items are added.

## Request Parameters

| Parameter | Type | Default | Max |
|-----------|------|---------|-----|
| `limit` | integer | 20 | 100 |
| `cursor` | string | null | — |

**Example:**

```bash
curl "https://api.aacp.dev/v1/orders?limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE3VDEwOjAwOjAwLjAwMFoiLCJpZCI6Im9yZF8xMjM0NSJ9" \
  -H "Authorization: Bearer $AACP_API_KEY"
```

## Response Shape

```json
{
  "data": [
    {
      "id": "ord_001",
      "status": "confirmed",
      "created_at": "2026-08-18T14:30:00.000Z"
    },
    {
      "id": "ord_002",
      "status": "pending",
      "created_at": "2026-08-18T14:15:00.000Z"
    }
  ],
  "meta": {
    "request_id": "req_1723987800000",
    "timestamp": "2026-08-18T14:30:00.000Z",
    "version": "v1"
  },
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE3VDA5OjAwOjAwLjAwMFoiLCJpZCI6Im9yZF85OTkifQ==",
    "has_more": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `next_cursor` | string ⎮ null | Base64-encoded keyset for the next page. `null` when no more results. |
| `has_more` | boolean | `true` if there are results beyond `limit`. |

---

## Cursor Format

Cursors are opaque, base64-encoded JSON:

```
eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE4VDEwOjAwOjAwLjAwMFoiLCJpZCI6Im9yZF8xMjM0NTY3OCJ9
```

Decoded:

```json
{
  "createdAt": "2026-08-18T10:00:00.000Z",
  "id": "ord_12345678"
}
```

Cursors are **stable** across API versions. You can store and reuse them later.

---

## Iteration Example

### First Request

No cursor — get the first page:

```bash
curl "https://api.aacp.dev/v1/orders?limit=20" \
  -H "Authorization: Bearer $AACP_API_KEY"
```

```json
{
  "data": [
    { "id": "ord_001", "status": "confirmed" },
    { "id": "ord_002", "status": "pending" },
    // ... 18 more items
  ],
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE3VDA5OjAwOjAwLjAwMFoiLCJpZCI6Im9yZF8yMDEifQ==",
    "has_more": true
  }
}
```

### Second Request

Use `next_cursor`:

```bash
curl "https://api.aacp.dev/v1/orders?limit=20&cursor=eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE3VDA5OjAwOjAwLjAwMFoiLCJpZCI6Im9yZF8yMDEifQ==" \
  -H "Authorization: Bearer $AACP_API_KEY"
```

```json
{
  "data": [
    { "id": "ord_021", "status": "shipped" },
    { "id": "ord_022", "status": "delivered" },
    // ... 18 more items
  ],
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTE3VDA4OjAwOjAwLjAwMFoiLCJpZCI6Im9yZF80MDEifQ==",
    "has_more": true
  }
}
```

### Loop Until `has_more` is `false`

```javascript
let cursor = null;
let allOrders = [];

while (true) {
  const params = new URLSearchParams({ limit: '100' });
  if (cursor) params.append('cursor', cursor);

  const response = await fetch(
    `https://api.aacp.dev/v1/orders?${params}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  const body = await response.json();
  allOrders = allOrders.concat(body.data);

  if (!body.pagination.has_more) break;
  cursor = body.pagination.next_cursor;
}

console.log(`Fetched ${allOrders.length} orders`);
```

---

## Best Practices

1. **Always check `has_more`** — do not assume a page is the last just because it has fewer than `limit` items.
2. **Store cursors if needed for resumption** — they are stable and can be persisted.
3. **Do not decode cursors in application code** — treat them as opaque strings.
4. **Combine with `limit`** — higher limits reduce requests but increase response size.
5. **Handle `next_cursor: null`** — it explicitly signals end-of-list, preventing off-by-one errors.
