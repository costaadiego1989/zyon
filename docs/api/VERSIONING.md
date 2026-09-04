# API Versioning & Deprecation Policy

## Version Scheme

The AACP API uses URL-path versioning:

```
https://api.aacp.dev/v1/orders
https://api.aacp.dev/v2/orders  (future)
```

## Stability Guarantee

Once released, a major API version (`v1`) is **stable**. We will not make breaking changes to existing endpoints within the same major version.

### What counts as a breaking change

- Removing an endpoint
- Removing or renaming a response field
- Changing a field's type
- Adding a new required parameter to an existing endpoint
- Changing authentication requirements for an existing endpoint
- Changing error codes or HTTP status codes for existing scenarios
- Changing the meaning of an existing field value

### What is NOT a breaking change

- Adding a new endpoint
- Adding a new optional field to a response
- Adding a new optional parameter to a request
- Adding a new webhook event type
- Adding a new enum value to an existing field
- Adding a new error code for a new error scenario
- Performance improvements

## Deprecation Process

When we need to remove or change something:

### 1. Announcement (Day 0)

- Field/endpoint marked as `deprecated` in OpenAPI spec
- Changelog entry published
- `Sunset` header added to deprecated endpoint responses:
  ```
  Sunset: Sat, 01 Jan 2027 00:00:00 GMT
  ```
- `Deprecation` header added:
  ```
  Deprecation: true
  ```

### 2. Migration Period (90 days minimum)

- Deprecated endpoint continues working exactly as before
- Documentation updated with migration guide
- API keys using deprecated endpoints trigger a warning email to the merchant

### 3. Removal (after 90+ days)

- Endpoint returns `410 Gone` with migration instructions
- After 30 more days, endpoint removed entirely (404)

## SDK Versioning

The TypeScript SDK (`zyon-sdk`) follows semver independently:

| SDK Change | Version Bump |
|------------|--------------|
| New API endpoints supported | Minor |
| Bug fix in SDK logic | Patch |
| Breaking change in SDK interface | Major |
| Generated types updated (non-breaking) | Patch |

## Rate Limit Tiers

Rate limits may be increased (never decreased) without notice:

| Tier | Current Limit | Guarantee |
|------|---------------|-----------|
| Free | 60 req/min | ≥30 req/min |
| Pro | 600 req/min | ≥300 req/min |
| Enterprise | 6,000 req/min | ≥3,000 req/min |

## How to Stay Updated

1. **Changelog**: Check [CHANGELOG.md](../../CHANGELOG.md) for all releases
2. **Sunset Headers**: Monitor `Sunset` and `Deprecation` response headers
3. **Webhook**: Subscribe to `api.deprecation_notice` event type
4. **Email**: We notify all API key owners before deprecations take effect
