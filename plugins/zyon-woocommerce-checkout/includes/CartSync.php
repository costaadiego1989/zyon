<?php
namespace Zyon;
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

/**
 * Handles AJAX cart sync from Zyon widget → WooCommerce server-side cart.
 *
 * When the widget removes or updates item quantities, it dispatches a
 * CustomEvent('zyon:cart:update') that the inline JS listener picks up
 * and forwards to this AJAX endpoint.
 */
class CartSync {
    public function __construct() {
        add_action('wp_ajax_zyon_cart_sync', [$this, 'handle']);
        add_action('wp_ajax_nopriv_zyon_cart_sync', [$this, 'handle']);
    }

    public function handle(): void {
        $nonce = isset($_SERVER['HTTP_X_WP_NONCE']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_X_WP_NONCE'])) : '';
        if (!wp_verify_nonce($nonce, 'zyon_cart_sync')) {
            wp_send_json_error(['message' => 'Invalid nonce'], 403);
        }

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);

        if (!is_array($data) || empty($data['items'])) {
            wp_send_json_error(['message' => 'Invalid payload'], 400);
        }

        if (!function_exists('WC') || !WC()->cart) {
            wp_send_json_error(['message' => 'WooCommerce cart unavailable'], 500);
        }

        foreach ($data['items'] as $item) {
            $sku = sanitize_text_field($item['sku'] ?? '');
            $quantity = max(0, (int) ($item['quantity'] ?? 0));

            if ($sku === '') {
                continue;
            }

            $cart_item_key = $this->find_cart_item_key_by_sku($sku);
            if ($cart_item_key === null) {
                continue;
            }

            if ($quantity === 0) {
                WC()->cart->remove_cart_item($cart_item_key);
            } else {
                WC()->cart->set_quantity($cart_item_key, $quantity);
            }
        }

        WC()->cart->calculate_totals();

        wp_send_json_success([
            'cart_count' => WC()->cart->get_cart_contents_count(),
            'cart_total' => WC()->cart->get_cart_contents_total(),
        ]);
    }

    private function find_cart_item_key_by_sku(string $sku): ?string {
        foreach (WC()->cart->get_cart() as $key => $item) {
            $product = $item['data'];
            $product_sku = $product->get_sku() ?: (string) $product->get_id();
            if ($product_sku === $sku) {
                return $key;
            }
        }
        return null;
    }
}
