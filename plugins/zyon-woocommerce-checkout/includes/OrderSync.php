<?php
namespace Zyon;

/**
 * Syncs WooCommerce order events to Zyon API
 */
class OrderSync {
    public function __construct() {
        add_action('woocommerce_payment_complete', [$this, 'on_payment_complete']);
        add_action('woocommerce_order_status_changed', [$this, 'on_status_changed'], 10, 4);
    }

    /**
     * When WooCommerce marks an order as paid
     */
    public function on_payment_complete(int $order_id): void {
        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        // Prevent duplicate sync
        $already_synced = $order->get_meta('_zyon_payment_synced');
        if ($already_synced === 'yes') {
            return;
        }

        // Notify Zyon API that payment is confirmed
        $this->notify_zyon('order.payment_confirmed', [
            'wc_order_id' => $order_id,
            'transaction_id' => $order->get_transaction_id(),
            'total' => (float) $order->get_total(),
            'currency' => $order->get_currency(),
            'status' => $order->get_status(),
        ]);

        // Mark as synced
        $order->update_meta_data('_zyon_payment_synced', 'yes');
        $order->save();
    }

    /**
     * When order status changes in WooCommerce
     */
    public function on_status_changed(int $order_id, string $from, string $to, \WC_Order $order): void {
        // Only sync certain transitions
        $sync_statuses = ['cancelled', 'refunded', 'completed'];
        if (!in_array($to, $sync_statuses, true)) {
            return;
        }

        $this->notify_zyon('order.status_changed', [
            'wc_order_id' => $order_id,
            'from_status' => $from,
            'to_status' => $to,
        ]);
    }

    /**
     * Send event to Zyon API
     */
    private function notify_zyon(string $event, array $data): void {
        $api_url = get_option('zyon_api_url', 'http://localhost:3000');
        $merchant_id = get_option('zyon_merchant_id', '');
        $api_key = get_option('zyon_api_key', '');

        if (empty($merchant_id) || empty($api_key)) {
            return;
        }

        $payload = wp_json_encode([
            'event' => $event,
            'merchant_id' => $merchant_id,
            'data' => $data,
            'timestamp' => gmdate('c'),
        ]);

        wp_remote_post(
            rtrim($api_url, '/') . '/commerce/woocommerce/webhook',
            [
                'headers' => [
                    'Content-Type' => 'application/json',
                    'x-aacp-api-key' => $api_key,
                ],
                'body' => $payload,
                'timeout' => 5,
                'blocking' => false,
            ]
        );
    }
}
