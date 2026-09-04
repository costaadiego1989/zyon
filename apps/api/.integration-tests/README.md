# ACP Live Integration Tests

These specs validate the AACP ACP stack against REAL external services. They
are NOT part of the regular unit-spec runner and are NOT safe to run in CI
without credentials.

Run with:

```bash
cd apps/api
# Step 1: compile TS → JS (uses tsconfig.int-spec.json)
npx tsc -p tsconfig.int-spec.json

# Step 2: run compiled suites
node --test dist-int-spec/.integration-tests/*.int-spec.js

# (optional) full clean rebuild — useful when service layer changes:
rm -rf dist-int-spec && npx tsc -p tsconfig.int-spec.json && \
  node --test dist-int-spec/.integration-tests/*.int-spec.js
```

Two-phase build is required because `node --experimental-strip-types` does
NOT rewrite import specifiers. The compiled `.js` files import other modules
via the `.js` extension (Node ESM rule), so the `.ts` source can't be
executed directly.

## When each test runs

Every test guards with `process.env.<VAR>` and skips with a short reason when
the variable is absent. Set the relevant subset for the provider you want to
exercise; everything else auto-skips.

| Test file | Required env | External service |
|-----------|--------------|------------------|
| `stripe-connect.int-spec.ts` | `STRIPE_SECRET_KEY_TEST`, `STRIPE_PUBLISHABLE_KEY_TEST` | Stripe Connect (test mode) |
| `asaas-split.int-spec.ts` | `ASAAS_API_KEY_SANDBOX` | Asaas sandbox |
| `webhook-delivery.int-spec.ts` | `AACP_API_URL` | local webhook receiver (no third party) |
| `mcp-claude.int-spec.ts` | `AACP_MCP_BIN`, `AACP_API_URL` | AACP MCP server binary + API |
| `ap2-mandate.int-spec.ts` | `AACP_API_URL` | AACP mandate endpoint (in-process ES256) |

## Common env vars

```env
# Required by all tests that talk to a running AACP API.
AACP_API_URL=http://localhost:3009

# Optional override — defaults to AACP_API_URL.
AACP_API_KEY=aacp_test_e2e_key
AACP_MERCHANT_ID=mrc_test

# Stripe Connect test mode. Use sk_test_*/pk_test_* keys only — non-test keys
# are refused by stripe-env.ts in non-prod.
STRIPE_SECRET_KEY_TEST=sk_test_...
STRIPE_PUBLISHABLE_KEY_TEST=pk_test_...

# Asaas sandbox token (NOT the production token). See [asaas-api-host-gotcha].
ASAAS_API_KEY_SANDBOX=$aact_...

# Path to the compiled AACP MCP server. Built via
#   pnpm --filter @zyon/aacp-mcp-server build
# Result is packages/aacp-mcp-server/dist/index.js.
AACP_MCP_BIN=../../packages/aacp-mcp-server/dist/index.js
```

## Stripe Connect

1. Create a Stripe test secret key at <https://dashboard.stripe.com/test/apikeys>.
2. Use the live `acct_create` flow (or the AACP admin onboarding flow) to
   create a Connect Express account in test mode. The test creates an account
   automatically if `STRIPE_CONNECT_ACCOUNT_ID_TEST` is not provided.
3. The amount 42639 (R$ 426,39) and application fee 298 (R$ 2,98) match the
   AACP default fee model — update them in the spec if your fees differ.

Stripe does not allow deleting test data; the spec only reads back what was
created and documents what to verify manually in the Dashboard.

## Asaas sandbox

1. Create an Asaas sandbox account at <https://sandbox.asaas.com>.
2. Generate an API token in the sandbox panel.
3. Sandbox API host is `api-sandbox.asaas.com`. The spec auto-resolves this
   when `ASAAS_SANDBOX=true` is set.

Required Asaas quirks (see [[asaas-api-host-gotcha]]):
- The token must be the SANDBOX token, not the production one.
- BaaS subaccounts require `companyType` for CNPJ accounts.
- PIX payments expire after 30 minutes by default.

## Webhook receiver

The webhook spec spins up a local HTTP server on `127.0.0.1:4000` and binds a
subscription to it. No ngrok required — AACP runs on the same host.

## MCP server

The MCP spec spawns the `aacp-mcp-server` binary as a child process and pipes
JSON-RPC over stdio. Build it first:

```bash
pnpm --filter @zyon/aacp-mcp-server build
```

The spec asserts that `tools/list` returns the five Phase-4 tools and that
`aacp_search_catalog` returns real catalog rows.

## AP2 mandates

The mandate spec issues a payment mandate via the public API and verifies the
ES256 signature, SD-JWT digests, audience (`credential-provider`), and `iat`
freshness using only `node:crypto`. No external library required.
