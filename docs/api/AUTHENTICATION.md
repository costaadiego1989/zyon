# Authentication

The AACP API supports two authentication methods. Every request must include exactly one.

## Service API Keys (Machine-to-Machine)

Service API keys authenticate automated integrations, backend services, and scripts.

### Header Format

```
Authorization: Bearer sk_live_abc123def456
```

### Key Prefixes

| Prefix | Environment | Purpose |
|--------|-------------|---------|
| `sk_live_` | Production | Real transactions, live data |
| `sk_test_` | Sandbox | Testing, development, CI/CD |

Test keys operate against isolated sandbox data. No real transactions are processed.

### How to Get an API Key

1. Log in to the [AACP Console](https://console.aacp.dev)
2. Navigate to **Settings > API Keys**
3. Click **Create API Key**
4. Select the environment (`test` or `live`)
5. Choose the scopes your integration requires
6. Copy the key — it is shown only once

### Key Properties

| Property | Description |
|----------|-------------|
| `credential_id` | Unique identifier for the key |
| `environment` | `test` or `live` |
| `scopes` | Permissions granted to this key |
| `created_at` | When the key was created |
| `last_used_at` | Last time the key authenticated a request |

### Security Best Practices

- Store keys in environment variables or a secrets manager — never commit them to source control.
- Use the minimum required scopes for each integration.
- Rotate keys periodically and revoke unused keys.
- Use `test` keys in development and CI/CD pipelines.

---

## Console Session (Human Access)

Dashboard and console users authenticate via a secure, httpOnly session cookie set during login.

| Property | Value |
|----------|-------|
| Cookie name | `aacp_session` |
| Scope | `console.aacp.dev` |
| Flags | `HttpOnly`, `Secure`, `SameSite=Lax` |
| Lifetime | 7 days (refreshed on activity) |

Console sessions have full access to the merchant's resources based on the user's role (`owner` or `admin`). No scope restrictions apply to human sessions — scope filtering is only for service API keys.

### Human-Only Endpoints

Some endpoints are restricted to console sessions and cannot be accessed by service API keys:

- `POST /v1/billing/subscription/change`
- `GET /v1/billing/usage`
- `GET /v1/billing/invoices`
- `PATCH /v1/team/members/:id/role`
- `DELETE /v1/team/members/:id`

These are marked with `humanOnly: true` in the scope check.

---

## Scope Reference

Service API keys are granted a subset of the following 31 scopes:

| Scope | Description |
|-------|-------------|
| `checkout:read` | Read checkout sessions and events |
| `checkout:write` | Create checkouts, post events, send messages, apply offers |
| `configuration:read` | Read merchant settings (agent rules, checkout, store, SEO) |
| `configuration:write` | Update merchant settings |
| `orders:read` | List and retrieve orders |
| `orders:write` | Cancel orders, update tracking |
| `customers:read` | List and retrieve customer profiles |
| `catalog:read` | Read products and categories |
| `embed:sessions:create` | Create embed session tokens for storefront |
| `tracking:read` | Read order tracking information |
| `tracking:write` | Update order tracking |
| `commerce:read` | List commerce platform connections |
| `commerce:write` | Create, update, delete, sync platform connections |
| `payments:read` | Read payment intents |
| `support:read` | Read support settings and tickets |
| `support:write` | Update support settings |
| `webhooks:read` | List and retrieve webhook endpoints |
| `webhooks:write` | Create, update, delete, test webhook endpoints |
| `audit:read` | Read audit event log |
| `analytics:read` | Access dashboard and product analytics |
| `coupons:read` | List coupons |
| `coupons:write` | Create coupons, validate coupon codes |
| `experiments:read` | List and retrieve experiments |
| `experiments:write` | Create, update, start, stop, archive, promote experiments |
| `team:read` | List team members |
| `team:write` | Invite members, change roles, remove members |
| `returns:read` | List return requests |
| `returns:write` | Create return requests |
| `installations:read` | List and retrieve app installations |
| `installations:write` | Install, update, uninstall apps |
| `billing:read` | Read plans, subscription, usage |
| `billing:write` | Change subscription plan |
| `integrations:read` | Read integration configurations |
| `integrations:write` | Manage integration configurations |

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `401 Unauthorized` | Missing or invalid credentials |
| `403 Forbidden` | Valid credentials but insufficient scope or role |

### 401 Example

```json
{
  "type": "https://api.aacp.dev/errors/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Missing or invalid API key.",
  "instance": "/v1/orders"
}
```

### 403 Example

```json
{
  "type": "https://api.aacp.dev/errors/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "API key does not have the required scope: orders:write",
  "instance": "/v1/orders/ord_123/cancel"
}
```
