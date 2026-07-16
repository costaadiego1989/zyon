<?php
namespace Zyon;

/**
 * Handles incoming webhooks from Zyon API (order.paid events)
 */
class WebhookHandler {
    private const NAMESPACE = 'zyon/v1';
    private const ROUTE = '/webhook';

    public function __construct() {
        add_action('rest_api_init', [$this, 'register_route']);
    }

    public function register_route(): void {
        register_rest_route(self::NAMESPACE, self::ROUTE, [
            'methods' => 'POST',
            'callback' => [$this, 'handle_webhook'],
            'permission_callback' => [$this, 'verify_hmac_signature'],
        ]);
    }

    /**
     * Verify HMAC signature from Zyon
     */
    public function verify_hmac_signature(\WP_REST_Request $request): bool {
        $signature = $request->get_header('x-zyon-signature');
        if (empty($signature)) {
            return false;
        }

        $secret = get_option('zyon_webhook_secret', '');
        if (empty($secret)) {
            return false;
        }

        $payload = $request->get_body();
        $expected = hash_hmac('sha256', $payload, $secret);

        return hash_equals($expected, $signature);
    }

    /**
     * Handle incoming webhook event
     */
    public function handle_webhook(\WP_REST_Request $request): \WP_REST_Response {
        $body = $request->get_json_params();

        if (!is_array($body) || empty($body['event'])) {
            return new \WP_REST_Response(['error' => 'invalid_payload'], 400);
        }

        $event = $body['event'];
        $data = $body['data'] ?? [];

        switch ($event) {
            case 'order.paid':
                return $this->handle_order_paid($data);

            case 'order.cancelled':
                return $this->handle_order_cancelled($data);

            default:
                return new \WP_REST_Response(['error' => 'unknown_event'], 400);
        }
    }

    /**
     * Handle order.paid: update WC order to processing
     */
    private function handle_order_paid(array $data): \WP_REST_Response {
        $order_id = $data['order_id'] ?? null;
        $transaction_id = $data['transaction_id'] ?? null;
        $amount = $data['amount'] ?? null;

        if (empty($order_id)) {
            return new \WP_REST_Response(['error' => 'missing_order_id'], 400);
        }

        // Find WooCommerce order by merchant reference
        $wc_order = $this->find_order_by_merchant_id($order_id);
        if (!$wc_order) {
            return new \WP_REST_Response(['error' => 'order_not_found'], 404);
        }

        // Update order
        if (!empty($transaction_id)) {
            $wc_order->set_transaction_id($transaction_id);
        }
        $wc_order->set_status('processing');
        $wc_order->save();

        return new \WP_REST_Response([
            'ok' => true,
            'order_id' => $wc_order->get_id(),
            'status' => 'processing',
        ], 200);
    }

    /**
     * Handle order.cancelled: update WC order to cancelled
     */
    private function handle_order_cancelled(array $data): \WP_REST_Response {
        $order_id = $data['order_id'] ?? null;
        if (empty($order_id)) {
            return new \WP_REST_Response(['error' => 'missing_order_id'], 400);
        }

        $wc_order = $this->find_order_by_merchant_id($order_id);
        if (!$wc_order) {
            return new \WP_REST_Response(['error' => 'order_not_found'], 404);
        }

        $wc_order->set_status('cancelled');
        $wc_order->save();

        return new \WP_REST_Response(['ok' => true], 200);
    }

    /**
     * Find WooCommerce order by Zyon merchant order ID
     */
    private function find_order_by_merchant_id(string $merchant_order_id): ?\WC_Order {
        $orders = wc_get_orders([
            'meta_key' => '_zyon_merchant_order_id',
            'meta_value' => $merchant_order_id,
            'limit' => 1,
        ]);

        return !empty($orders) ? $orders[0] : null;
    }
}
