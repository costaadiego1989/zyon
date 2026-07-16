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

## Testing

```bash
composer install
vendor/bin/phpunit
```

## License

GPL v3
