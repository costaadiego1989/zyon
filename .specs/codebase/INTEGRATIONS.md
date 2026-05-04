# Integrations

## Shopify

The MVP uses Shopify Admin API for discount code creation. If credentials are missing, the adapter returns a deterministic development fallback so the end-to-end flow still works locally.

Required environment:

- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`

## OpenAI

Conversation uses the OpenAI Responses API when `OPENAI_API_KEY` is set. Without it, the conversation engine returns safe deterministic fallback messages.

Required environment:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
