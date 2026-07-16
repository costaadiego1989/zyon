<?php
namespace Zyon;

/**
 * Embeds the Zyon Checkout Agent widget on WooCommerce checkout page
 */
class CheckoutEmbed {
    private const WIDGET_SCRIPT_URL = 'https://cdn.zyon.com/widget/latest/zyon-checkout-agent.js';

    public function __construct() {
        add_action('woocommerce_after_checkout_form', [$this, 'render_widget']);
        add_action('wp_enqueue_scripts', [$this, 'enqueue_widget_script']);
    }

    public function enqueue_widget_script(): void {
        if (!is_checkout()) {
            return;
        }

        $merchant_id = get_option('zyon_merchant_id', '');
        if (empty($merchant_id)) {
            return;
        }

        // Load widget bundle
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
        $merchant_id = get_option('zyon_merchant_id', '');
        $api_key = get_option('zyon_api_key', '');
        $api_url = get_option('zyon_api_url', 'http://localhost:3000');

        if (empty($merchant_id) || empty($api_key)) {
            return;
        }

        // Fetch embed session token
        $token_service = new EmbedToken($api_url, $api_key, $merchant_id);
        $embed_token = $token_service->fetch();

        if (empty($embed_token)) {
            // Fallback: render without token (widget will show error state)
            error_log('[Zyon] Could not fetch embed token, rendering widget without it');
        }

        printf(
            '<zyon-checkout-agent data-merchant-id="%s" data-api-base-url="%s" embed-session-token="%s"></zyon-checkout-agent>',
            esc_attr($merchant_id),
            esc_attr($api_url),
            esc_attr($embed_token ?? '')
        );
    }
}
