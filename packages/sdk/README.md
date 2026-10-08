# @zyon/sdk

TypeScript SDK for the AACP Integration API. Auto-generated from the OpenAPI spec using [Orval](https://orval.dev).

## Installation

```bash
npm install @zyon/sdk
# or
pnpm add @zyon/sdk
```

## Quick Start

```typescript
import { createClient } from '@zyon/sdk';

const aacp = createClient({
  apiKey: 'aacp_test_...',
  environment: 'sandbox', // or 'production'
});

// After running `pnpm generate`, typed resource clients will be available:
// const checkout = await aacp.checkouts.start({
//   session_id: 'sess_123',
//   cart: [{ sku: 'PROD-1', name: 'Widget', price: 2990, quantity: 1 }],
// });
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | — | Your AACP API key (`aacp_test_*` or `aacp_live_*`) |
| `baseUrl` | `string?` | — | Override the base URL entirely |
| `environment` | `'sandbox' \| 'production'` | `'sandbox'` | Target environment |
| `timeout` | `number?` | `30000` | Request timeout in ms |
| `maxRetries` | `number?` | `3` | Max retries for 429/5xx |

## Error Handling

All API errors are thrown as `ApiError` instances following RFC 7807 (Problem Details):

```typescript
import { createClient, ApiError } from '@zyon/sdk';

try {
  await aacp.instance.get('/checkouts/nonexistent');
} catch (err) {
  if (err instanceof ApiError) {
    console.log(err.status);        // 404
    console.log(err.code);          // "checkout_not_found"
    console.log(err.title);         // "Checkout session not found"
    console.log(err.correlationId); // "corr_abc123"
  }
}
```

## Regenerating the SDK

The SDK is generated from the live OpenAPI spec served by the API at `/openapi.json`.

```bash
# Start the API locally
cd apps/api && pnpm dev

# In another terminal, regenerate
cd packages/sdk && pnpm generate
```

This regenerates all typed clients in `src/generated/`. Commit the result.

## Development

```bash
pnpm install
pnpm generate   # requires API running at localhost:3000
pnpm build      # compile TypeScript
```
