<?php
namespace Zyon;

/**
 * Replaces WooCommerce checkout with Zyon Checkout Agent widget.
 * The widget takes over the entire checkout flow (cart review + payment + confirmation).
 */
class CheckoutEmbed {
    private const WIDGET_SCRIPT_URL = 'http://localhost:3009/widget/aacp.js';

    public function __construct() {
        // Load widget script on checkout page
        add_action('wp_enqueue_scripts', [$this, 'enqueue_widget_script']);
        // Hide native WooCommerce checkout and replace with widget
        add_action('wp_enqueue_scripts', [$this, 'hide_native_checkout']);
        // Render widget in footer (works with both block and shortcode checkout)
        add_action('wp_footer', [$this, 'render_widget']);
    }

    /**
     * Hide native WooCommerce checkout form via CSS
     */
    public function hide_native_checkout(): void {
        if (!is_checkout() || is_wc_endpoint_url('order-received')) {
            return;
        }

        $merchant_id = get_option('zyon_merchant_id', '');
        if (empty($merchant_id)) {
            return;
        }

        wp_add_inline_style('wp-block-library', '
            .wp-block-woocommerce-checkout,
            .woocommerce-checkout,
            .wc-block-checkout,
            form.checkout,
            #order_review,
            .woocommerce-form-coupon-toggle,
            .woocommerce-info {
                display: none !important;
            }
            .zyon-checkout-wrapper {
                max-width: 100%;
                min-height: 600px;
                margin: 0 auto;
                padding: 20px 0;
            }
            zyon-checkout-agent {
                display: block;
                width: 100%;
                min-height: 500px;
            }
        ');
    }

    public function enqueue_widget_script(): void {
        if (!is_checkout() || is_wc_endpoint_url('order-received')) {
            return;
        }

        $merchant_id = get_option('zyon_merchant_id', '');
        if (empty($merchant_id)) {
            return;
        }

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
        if (!is_checkout() || is_wc_endpoint_url('order-received')) {
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

        printf(
            '<div class="zyon-checkout-wrapper">' .
            '<zyon-checkout-agent data-merchant-id="%s" data-api-base-url="%s" embed-session-token="%s" presentation-mode="inline"></zyon-checkout-agent>' .
            '</div>',
            esc_attr($merchant_id),
            esc_attr($browser_api_url),
            esc_attr($embed_token ?? '')
        );
    }
}
