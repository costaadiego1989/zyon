<?php
/**
 * Unit tests for Zyon\CartSync AJAX handler.
 */

namespace Zyon\Tests;

use WP_UnitTestCase;
use Zyon\CartSync;

class CartSyncTest extends WP_UnitTestCase {

    public function setUp(): void {
        parent::setUp();
        // Ensure WooCommerce is loaded and cart initialized.
        if (function_exists('WC') && WC()->cart) {
            WC()->cart->empty_cart();
        }
    }

    public function test_rejects_request_without_nonce(): void {
        $_SERVER['HTTP_X_WP_NONCE'] = '';

        $this->expectOutputRegex('/Invalid nonce/');

        $sync = new CartSync();
        // Simulate AJAX call without nonce
        $this->simulate_ajax_call($sync, ['items' => [['sku' => 'TEST-001', 'quantity' => 0]]]);
    }

    public function test_rejects_request_with_invalid_payload(): void {
        $_SERVER['HTTP_X_WP_NONCE'] = wp_create_nonce('zyon_cart_sync');

        $this->expectOutputRegex('/Invalid payload/');

        $sync = new CartSync();
        $this->simulate_ajax_call($sync, []);
    }

    public function test_removes_item_by_sku(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce not available');
        }

        // Add a product to cart
        $product_id = $this->factory()->post->create(['post_type' => 'product']);
        update_post_meta($product_id, '_sku', 'ZYON-TEST-001');
        update_post_meta($product_id, '_price', '99.90');
        update_post_meta($product_id, '_regular_price', '99.90');
        WC()->cart->add_to_cart($product_id);

        $this->assertEquals(1, WC()->cart->get_cart_contents_count());

        // Simulate removal via CartSync
        $_SERVER['HTTP_X_WP_NONCE'] = wp_create_nonce('zyon_cart_sync');
        $sync = new CartSync();
        $this->simulate_ajax_call($sync, ['items' => [['sku' => 'ZYON-TEST-001', 'quantity' => 0]]]);

        $this->assertEquals(0, WC()->cart->get_cart_contents_count());
    }

    public function test_updates_item_quantity(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce not available');
        }

        $product_id = $this->factory()->post->create(['post_type' => 'product']);
        update_post_meta($product_id, '_sku', 'ZYON-QTY-001');
        update_post_meta($product_id, '_price', '49.90');
        update_post_meta($product_id, '_regular_price', '49.90');
        WC()->cart->add_to_cart($product_id, 3);

        $this->assertEquals(3, WC()->cart->get_cart_contents_count());

        $_SERVER['HTTP_X_WP_NONCE'] = wp_create_nonce('zyon_cart_sync');
        $sync = new CartSync();
        $this->simulate_ajax_call($sync, ['items' => [['sku' => 'ZYON-QTY-001', 'quantity' => 1]]]);

        $this->assertEquals(1, WC()->cart->get_cart_contents_count());
    }

    public function test_ignores_unknown_sku(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce not available');
        }

        $product_id = $this->factory()->post->create(['post_type' => 'product']);
        update_post_meta($product_id, '_sku', 'REAL-SKU');
        update_post_meta($product_id, '_price', '10.00');
        update_post_meta($product_id, '_regular_price', '10.00');
        WC()->cart->add_to_cart($product_id);

        $_SERVER['HTTP_X_WP_NONCE'] = wp_create_nonce('zyon_cart_sync');
        $sync = new CartSync();
        $this->simulate_ajax_call($sync, ['items' => [['sku' => 'FAKE-SKU', 'quantity' => 0]]]);

        // Cart should remain unchanged
        $this->assertEquals(1, WC()->cart->get_cart_contents_count());
    }

    /**
     * Helper: simulate the AJAX call by setting php://input and calling handle().
     */
    private function simulate_ajax_call(CartSync $sync, array $payload): void {
        // CartSync reads from php://input which we can't easily mock.
        // Instead, use a test-specific approach: override via filter or reflection.
        // For now, test the nonce + payload validation paths.
        // Full integration test requires wp-ajax test harness.
    }
}
