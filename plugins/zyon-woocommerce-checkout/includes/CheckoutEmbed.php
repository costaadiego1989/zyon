<?php
namespace Zyon;

/**
 * Replaces WooCommerce cart/checkout with Zyon Checkout Agent widget.
 * The widget takes over the entire checkout flow (cart + payment + confirmation).
 * It renders fullscreen, hiding all native WooCommerce UI.
 */
class CheckoutEmbed {
    private const WIDGET_SCRIPT_URL = 'http://localhost:3009/widget/aacp.js';

    public function __construct() {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_widget_script']);
        add_action('wp_enqueue_scripts', [$this, 'inject_styles']);
        add_action('wp_footer', [$this, 'render_widget']);
    }

    /**
     * Inject CSS to hide native WooCommerce and make widget fullscreen
     */
    public function inject_styles(): void {
        if (!is_cart() && !is_checkout()) {
            return;
        }
        if (is_wc_endpoint_url('order-received')) {
            return;
        }

        $merchant_id = get_option('zyon_merchant_id', '');
        if (empty($merchant_id)) {
            return;
        }

        wp_add_inline_style('wp-block-library', '
            /* Hide ALL native WooCommerce content */
            .wp-block-woocommerce-checkout,
            .woocommerce-checkout,
            .wc-block-checkout,
            .wp-block-woocommerce-cart,
            .wc-block-cart,
            .woocommerce-cart-form,
            .cart-collaterals,
            form.checkout,
            #order_review,
            .woocommerce-form-coupon-toggle,
            .woocommerce-info,
            .entry-content > *:not(.zyon-checkout-takeover),
            .wp-block-post-content > *:not(.zyon-checkout-takeover) {
                display: none !important;
            }

            /* Hide header and footer for immersive checkout */
            header.wp-block-template-part,
            footer.wp-block-template-part,
            .wp-block-template-part[data-type="footer"],
            .site-header,
            .site-footer {
                display: none !important;
            }

            /* Widget takeover: fullscreen */
            .zyon-checkout-takeover {
                position: fixed !important;
                inset: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 999999 !important;
                background: #08080c !important;
            }

            /* Override widget internal fixed positioning to fill parent */
            .zyon-checkout-takeover zyon-checkout-agent {
                display: block !important;
                width: 100% !important;
                height: 100% !important;
            }

            .zyon-checkout-takeover zyon-checkout-agent > div,
            .zyon-checkout-takeover zyon-checkout-agent > div > div,
            .zyon-checkout-takeover zyon-checkout-agent > div > div > div {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
                max-height: 100% !important;
                max-width: 100% !important;
                border-radius: 0 !important;
                bottom: auto !important;
                right: auto !important;
                box-shadow: none !important;
                overflow: visible !important;
            }
        ');
    }

    public function enqueue_widget_script(): void {
        if (!is_cart() && !is_checkout()) {
            return;
        }
        if (is_wc_endpoint_url('order-received')) {
            return;
        }

        $merchant_id = get_option('zyon_merchant_id', '');
        if (empty($merchant_id)) {
            return;
        }

        // Load widget CSS
        $browser_api_url = get_option('zyon_browser_api_url', get_option('zyon_api_url', 'http://localhost:3009'));
        wp_enqueue_style(
            'zyon-checkout-widget-css',
            rtrim($browser_api_url, '/') . '/widget/widget.css',
            [],
            ZYON_CHECKOUT_VERSION
        );

        // Load widget JS
        $script_url = get_option('zyon_widget_url', self::WIDGET_SCRIPT_URL);
        wp_enqueue_script(
            'zyon-checkout-widget',
            $script_url,
            [],
            ZYON_CHECKOUT_VERSION,
            true
        );
    }

    public function render_widget(): void {
        if (!is_cart() && !is_checkout()) {
            return;
        }
        if (is_wc_endpoint_url('order-received')) {
            return;
        }

        $merchant_id = get_option('zyon_merchant_id', '');
        $api_key = get_option('zyon_api_key', '');
        $api_url = get_option('zyon_api_url', 'http://localhost:3000');
        $browser_api_url = get_option('zyon_browser_api_url', $api_url);

        if (empty($merchant_id) || empty($api_key)) {
            return;
        }

        // Fetch embed session token (server-side call)
        $token_service = new EmbedToken($api_url, $api_key, $merchant_id);
        $embed_token = $token_service->fetch();

        if (empty($embed_token)) {
            error_log('[Zyon] Could not fetch embed token, rendering widget without it');
        }

        // Get WooCommerce cart items to pass to widget
        $cart_json = '';
        if (function_exists('WC') && WC()->cart) {
            $cart_items = [];
            $cart_total = 0;
            foreach (WC()->cart->get_cart() as $item) {
                $product = $item['data'];
                $price = (float) $product->get_price();
                $qty = (int) $item['quantity'];
                $cart_items[] = [
                    'sku' => $product->get_sku() ?: (string) $product->get_id(),
                    'name' => $product->get_name(),
                    'price' => $price,
                    'quantity' => $qty,
                ];
                $cart_total += $price * $qty;
            }
            if (!empty($cart_items)) {
                $cart_json = wp_json_encode([
                    'currency' => get_woocommerce_currency(),
                    'total' => $cart_total,
                    'items' => $cart_items,
                    'source' => 'storefront',
                ]);
            }
        }

        printf(
            '<div class="zyon-checkout-takeover">' .
            '<zyon-checkout-agent merchant-id="%s" api-base-url="%s" embed-session-token="%s" presentation-mode="inline" cart-json="%s"></zyon-checkout-agent>' .
            '</div>',
            esc_attr($merchant_id),
            esc_attr($browser_api_url),
            esc_attr($embed_token ?? ''),
            esc_attr($cart_json)
        );
    }
}
