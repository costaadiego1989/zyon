# ERP live validation

This suite is intentionally disabled by default. It operates on real ERP accounts and never stores credentials in the repository.

1. In PowerShell, run `$env:PLAYWRIGHT_BASE_URL = "https://app.zyon-payments.com.br"; pnpm e2e:erp-live:auth`. It opens regular Google Chrome, rather than a Playwright browser. Complete the dashboard login in that window; it saves an authenticated storage state outside Git.
2. Set `$env:RUN_LIVE_ERP_TESTS = "1"`, `$env:PLAYWRIGHT_BASE_URL = "https://app.zyon-payments.com.br"`, and `$env:ERP_LIVE_STORAGE_STATE` with that file path.
3. Set only the provider credentials that need a new connection: `$env:ERP_LIVE_OMIE_APP_KEY`, `$env:ERP_LIVE_OMIE_APP_SECRET`, and `$env:ERP_LIVE_TINY_API_TOKEN`.
4. Run `pnpm e2e:erp-live --headed` from `apps/dashboard`.

Bling uses OAuth. Complete its login, consent, and any two-factor verification interactively in the dashboard first; the suite then triggers and verifies the real stock snapshot. Provisioning a dedicated product and quantity in each real ERP remains a separate opt-in step, so the account owner can choose the test SKU and stock before any remote inventory is created.
