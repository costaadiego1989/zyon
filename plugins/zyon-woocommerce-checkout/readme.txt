=== Zyon Agentic Checkout for WooCommerce ===
Contributors: zyonai
Tags: checkout, woocommerce, ai, agentic, conversion
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv3
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Bring the Zyon AI Checkout Agent to WooCommerce with secure widget embedding, signed webhooks, and order status sync.

== Description ==

Zyon Agentic Checkout for WooCommerce integrates the Zyon AI Checkout Agent into WooCommerce stores. It can replace the native cart and checkout experience with a secure embedded checkout agent while preserving native WooCommerce checkout when the plugin is not fully configured.

Key features:

* Secure server-side embed token fetching.
* Configurable API, widget, and browser API URLs.
* Signed webhook endpoint for Zyon order events.
* WooCommerce order payment, cancellation, and tracking updates.
* Outbound order status sync to Zyon.
* Production-safe settings that never render stored secrets back into the admin page.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/zyon-woocommerce-checkout/` or install it from WordPress.org.
2. Activate **Zyon Agentic Checkout for WooCommerce** from the Plugins screen.
3. Go to **WooCommerce > Zyon Checkout**.
4. Configure Merchant ID, API Key, API URL, Webhook Secret, and optional Widget URL or Browser API URL.
5. Use HTTPS URLs in production. Non-HTTPS URLs require defining `ZYON_DEV_MODE` for local development.
6. Configure your Zyon webhook target as `/wp-json/zyon/v1/webhook`.

== Frequently Asked Questions ==

= What happens if the plugin is not configured? =

The Zyon widget is not rendered. Buyers continue through the native WooCommerce checkout.

= Are API keys or webhook secrets shown in the admin HTML? =

No. Secret fields render empty password inputs. If a secret is already configured, the field shows a placeholder and leaving it blank preserves the existing secret.

= Can I use localhost URLs? =

Only when `ZYON_DEV_MODE` is defined. Production settings require `https://` URLs.

= Which webhooks are supported? =

The plugin handles paid, cancelled, shipped, and tracking update order events from Zyon.

== Compatibility ==

= Tested environments =

| WordPress | WooCommerce | PHP  | Status |
|-----------|------------|------|--------|
| 6.4+      | 8.5+       | 8.1+ | ✅ Full support |
| 6.0–6.3   | 7.0–8.4    | 7.4+ | ✅ Compatible (legacy block checkout may need classic shortcode) |
| 5.x       | < 7.0      | < 7.4 | ❌ Not supported |

= Block-based vs Classic checkout =

The plugin supports both WooCommerce block-based checkout and classic shortcode checkout.
In block-based mode, it intercepts `template_redirect` to serve a full-page takeover.
In classic mode, it filters `the_content` on cart/checkout pages.

== Changelog ==

= 1.0.0 =
* Production release.
* Removed localhost defaults and hardcoded widget URL fallbacks.
* Added configurable widget and browser API URLs.
* Hardened secret settings, webhook signature verification, timestamp freshness, and sync logging.
* Added uninstall cleanup and WordPress.org packaging files.
