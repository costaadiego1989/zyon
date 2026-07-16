<?php
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
     * RED: Order status should update from pending to processing on payment
     */
    public function test_order_status_updates_on_payment() {
        // Create a test order
        $order = wc_create_order();
        $order_id = $order->get_id();
        $order->set_status('pending');
        $order->save();

        // Simulate payment completion webhook
        do_action('woocommerce_payment_complete', $order_id);

        // Reload order
        $updated_order = wc_get_order($order_id);
        $this->assertEquals('processing', $updated_order->get_status());
    }

    /**
     * RED: Order should not have duplicate sync events
     */
    public function test_order_sync_idempotent() {
        $order = wc_create_order();
        $order_id = $order->get_id();
        $order->set_status('pending');
        $order->save();

        // Fire payment completion twice
        do_action('woocommerce_payment_complete', $order_id);
        do_action('woocommerce_payment_complete', $order_id);

        // Order should still be processing (not double-updated)
        $updated_order = wc_get_order($order_id);
        $this->assertEquals('processing', $updated_order->get_status());
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
