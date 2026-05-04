# Testing

## MVP Gates

- `pnpm typecheck`
- `pnpm build`

## Required Scenarios

- Checkout start creates `session_id`, `conversation_id`, and `global_user_id`.
- Repeated customer hints reuse `global_user_id`.
- Events update abandonment score and trigger state.
- Chat fallback never invents unauthorized offers.
- Shipping and discount rules block minimum-margin violations.
- Applying an offer records acceptance and returns Shopify apply URL or dev fallback.
- Dashboard overview remains scoped by `merchant_id`.
