# Zyon Agentic Checkout for WooCommerce

WordPress plugin that integrates the Zyon AI Checkout Agent into WooCommerce stores.

## Features

- Embeds `<zyon-checkout-agent>` widget on WooCommerce checkout page
- Receives order events from Zyon API via signed webhooks
- Syncs WooCommerce order status changes back to Zyon
- Auto-fetches fresh embed session tokens on each checkout render

## Installation

1. Copy this folder to `wp-content/plugins/zyon-woocommerce-checkout/`
2. Activate the plugin in WordPress admin
3. Go to **WooCommerce > Zyon Checkout** and configure:
   - **Merchant ID** — your Zyon merchant ID (from Zyon dashboard)
   - **API Key** — API key with `embed:sessions:create` scope
   - **API URL** — Zyon API endpoint (default: `http://localhost:3000`)
   - **Webhook Secret** — shared HMAC secret for verifying Zyon webhooks

## Architecture

```
WooCommerce Store
  ↓ (render on checkout page)
plugins/zyon-woocommerce-checkout/
  ├── includes/
  │   ├── Settings.php          ← WP admin UI
  │   ├── CheckoutEmbed.php     ← Widget render
  │   ├── EmbedToken.php        ← Token fetcher
  │   ├── WebhookHandler.php    ← Zyon → WP callbacks
  │   └── OrderSync.php         ← WP → Zyon notifications
  └── tests/                    ← PHPUnit suite
```

## Endpoints

- `POST /wp-json/zyon/v1/webhook` — receives `order.paid` / `order.cancelled` from Zyon
- HMAC signature verified via `x-zyon-signature` header

## Development Mode

For local development with HTTP URLs (localhost), add to `wp-config.php`:

```php
define('ZYON_DEV_MODE', true);
```

This allows:
- `http://` URLs in settings (production requires `https://`)
- `http://localhost:*` and `http://host.docker.internal:*` accepted
- Dev embed token auto-generated when API token fetch fails

**Never enable in production.**

## Graceful Fallback

If the Zyon API is unreachable (circuit breaker open, token fetch fails):
- Plugin falls back to native WooCommerce checkout automatically
- No blank pages — buyers can always complete their purchase
- Warning logged to WooCommerce logs (`WooCommerce > Status > Logs > zyon-checkout`)

## Token Caching

Embed session tokens are cached for 12 minutes (WordPress transient).
Token TTL from API = 15 minutes. Plugin refreshes 3 min before expiry.
This eliminates per-page-load API calls (~200-500ms saved per checkout view).

## Testing

```bash
composer install
WP_TESTS_DIR=/tmp/wordpress-tests-lib vendor/bin/phpunit
```

Test suite covers: activation, settings, embed rendering, webhook HMAC, order sync, cart sync, HTTP client (retry + circuit breaker), full integration flow.

## License

GPL v3
