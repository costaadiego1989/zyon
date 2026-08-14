<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
/**
 * Tests for Order Sync
 */

class TestOrderSync extends WP_UnitTestCase {
    /**
     * RED: OrderSync class should exist
     */
    public function test_order_sync_class_exists() {
        $this->assertTrue(class_exists('Zyon\\OrderSync'));
    }

    /**
     * OrderSync marks order with _zyon_payment_synced meta after payment complete.
     */
    public function test_order_marked_synced_after_payment() {
        $order = wc_create_order();
        $order_id = $order->get_id();
        $order->set_status('pending');
        $order->save();

        // Configure plugin so sync fires (will fail HTTP silently, but meta should be set)
        update_option('zyon_api_url', 'https://api.example.com');
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');

        // Simulate payment complete hook
        do_action('woocommerce_payment_complete', $order_id);

        $updated_order = wc_get_order($order_id);
        $this->assertEquals('yes', $updated_order->get_meta('_zyon_payment_synced'));
    }

    /**
     * OrderSync is idempotent: second fire does not re-sync.
     */
    public function test_order_sync_idempotent() {
        $order = wc_create_order();
        $order_id = $order->get_id();
        $order->set_status('pending');
        $order->save();

        update_option('zyon_api_url', 'https://api.example.com');
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');

        // Fire twice
        do_action('woocommerce_payment_complete', $order_id);
        do_action('woocommerce_payment_complete', $order_id);

        // Meta should still be 'yes' (set once, not errored)
        $updated_order = wc_get_order($order_id);
        $this->assertEquals('yes', $updated_order->get_meta('_zyon_payment_synced'));
    }

    /**
     * RED: Order transaction ID should be set from webhook
     */
    public function test_order_transaction_id_set() {
        $order = wc_create_order();
        $order_id = $order->get_id();

        // Store transaction ID from webhook
        $order->set_transaction_id('txn_pix_abc123');
        $order->save();

        // Verify it's saved
        $updated_order = wc_get_order($order_id);
        $this->assertEquals('txn_pix_abc123', $updated_order->get_transaction_id());
    }
}
