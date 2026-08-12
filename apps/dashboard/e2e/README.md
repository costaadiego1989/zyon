# Dashboard E2E Infrastructure

## Directory Structure

```
e2e/
├── config.ts                    # Shared constants, URLs, timeouts, env vars
├── auth-setup.ts                # Global setup: login once, save storageState
├── auth-login.spec.ts           # Auth flow tests (unauthenticated project)
├── fixtures/
│   ├── auth.fixture.ts          # Authenticated test fixture (login/logout helpers)
│   ├── api-helpers.ts           # API setup/teardown (seed, cleanup, health)
│   └── test-data.ts             # Constants, factories, E2E_RUN_ID
├── page-objects/
│   ├── index.ts                 # Barrel export
│   ├── base-page.ts             # Abstract base (nav, shell, common locators)
│   ├── auth-page.ts             # Login/signup/forgot page
│   ├── dashboard-page.ts        # Overview/metrics page
│   ├── orders-page.ts           # Orders table
│   ├── customers-page.ts        # Customers table
│   └── integrations-page.ts     # API keys/webhooks
├── utils/
│   ├── index.ts                 # Barrel export
│   ├── selectors.ts             # Stable selector constants
│   ├── wait-helpers.ts          # Explicit wait patterns (no waitForTimeout)
│   └── assertions.ts            # Reusable assertion helpers
├── .auth/                       # gitignored — storageState lives here
└── .gitignore
```

## Projects (playwright.config.ts)

| Project | Browser | Auth | Tests |
|---------|---------|------|-------|
| auth-setup | Chrome | None | Login + save storageState |
| dashboard-chromium | Chrome | storageState | All except auth-*.spec.ts |
| dashboard-firefox | Firefox (CI only) | storageState | All except auth-*.spec.ts |
| dashboard-mobile | Pixel 5 | storageState | *.mobile.spec.ts only |
| dashboard-auth | Chrome | None | auth-*.spec.ts only |

## Running Tests

```bash
# All tests (requires running API)
cd apps/dashboard && pnpm e2e

# Auth tests only
pnpm e2e -- --project=dashboard-auth

# Specific tag
pnpm e2e -- --grep @auth-login-valid

# Mobile tests
pnpm e2e -- --project=dashboard-mobile
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_TEST_EMAIL` | demo@zyon.com | Login email |
| `E2E_TEST_PASSWORD` | demo1234 | Login password |
| `PLAYWRIGHT_BASE_URL` | http://localhost:5175 | Dashboard URL |
| `E2E_API_URL` | http://127.0.0.1:3009 | API URL |
| `CI` | (unset) | Enables retries, Firefox, parallel workers |

## Prerequisites

1. API running: `cd apps/api && pnpm dev`
2. Dashboard running (auto-started by webServer config) or `cd apps/dashboard && pnpm dev`
3. Database seeded with demo@zyon.com / demo1234

## Writing New Tests

```typescript
// Use page objects
import { AuthPage, DashboardPage } from "./page-objects";
import { waitForApiCall } from "./utils/wait-helpers";
import { assertAuthenticated } from "./utils/assertions";

// For authenticated tests (storageState is pre-loaded):
import { test, expect } from "@playwright/test";

// For tests that need fresh auth control:
import { test, expect } from "./fixtures/auth.fixture";
```

## Selectors Strategy

Priority order:
1. `data-testid` attributes
2. `role` (ARIA roles)
3. `label` / `placeholder`
4. Text content (last resort)

Never use: CSS classes, XPath, nth-child chains.
