# ERP live validation

This suite is intentionally disabled by default. It operates on real ERP accounts and never stores credentials in the repository.

1. Log in to the production dashboard in a local browser and save the authenticated Playwright storage state outside Git.
2. Export `RUN_LIVE_ERP_TESTS=1`, `PLAYWRIGHT_BASE_URL=https://app.zyon-payments.com.br`, and `ERP_LIVE_STORAGE_STATE` with that file path.
3. Export only the provider credentials that need a new connection: `ERP_LIVE_OMIE_APP_KEY`, `ERP_LIVE_OMIE_APP_SECRET`, and `ERP_LIVE_TINY_API_TOKEN`.
4. Run `pnpm e2e:erp-live` from `apps/dashboard`.

Bling uses OAuth. Complete its login, consent, and any two-factor verification interactively in the dashboard first; the suite then triggers and verifies the real stock snapshot. Provisioning a dedicated product and quantity in each real ERP remains a separate opt-in step, so the account owner can choose the test SKU and stock before any remote inventory is created.
