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
        $secret = get_option('zyon_webhook_secret', '');
        if (empty($secret)) {
            return false;
        }

        $payload = $request->get_body();

        $aacp_signature = $request->get_header('x-aacp-signature');
        $aacp_timestamp = $request->get_header('x-aacp-timestamp');
        if (!empty($aacp_signature) && !empty($aacp_timestamp)) {
            $expected = 'sha256=' . hash_hmac('sha256', $aacp_timestamp . '.' . $payload, $secret);
            return hash_equals($expected, $aacp_signature);
        }

        $signature = $request->get_header('x-zyon-signature');
        if (empty($signature)) {
            return false;
        }

        $expected = hash_hmac('sha256', $payload, $secret);

        return hash_equals($expected, $signature);
    }

    /**
     * Handle incoming webhook event
     */
    public function handle_webhook(\WP_REST_Request $request): \WP_REST_Response {
        $body = $request->get_json_params();

        if (!is_array($body)) {
            return new \WP_REST_Response(['error' => 'invalid_payload'], 400);
        }

        $body = $this->normalize_payload($body);
        if (empty($body['event'])) {
            return new \WP_REST_Response(['error' => 'invalid_payload'], 400);
        }

        $event = $body['event'];
        $data = $body['data'] ?? [];

        switch ($event) {
            case 'order.paid':
                return $this->handle_order_paid($data);

            case 'order.cancelled':
                return $this->handle_order_cancelled($data);

            case 'order.tracking.updated':
                return $this->handle_tracking_updated($data);

            case 'order.shipped':
                return $this->handle_tracking_updated($data);

            default:
                return new \WP_REST_Response(['error' => 'unknown_event'], 400);
        }
    }

    /**
     * Normalize webhook payload to the internal {event, data} shape.
     * Supports legacy {event, data} envelopes and AACP {event_type, data} envelopes.
     */
    public function normalize_payload(array $body): array {
        if (isset($body['event'])) {
            return $body;
        }

        $event_type = $body['event_type'] ?? '';
        $data = $body['data'] ?? [];

        if ($event_type === 'order.approved') {
            $order = $data['order'] ?? [];
            $payment = $data['payment'] ?? [];
            $tracking = $data['tracking'] ?? [];

            return [
                'event' => 'order.paid',
                'data' => [
                    'order_id' => $order['external_order_id'] ?? ($order['id'] ?? null),
                    'transaction_id' => $payment['provider_reference'] ?? ($order['external_order_id'] ?? null),
                    'amount' => isset($payment['amount']) ? ((float) $payment['amount']) / 100 : null,
                    'currency' => $payment['currency'] ?? ($order['currency'] ?? null),
                    'tracking_code' => $tracking['tracking_code'] ?? null,
                ],
            ];
        }

        if ($event_type === 'order.tracking.updated') {
            $order = $data['order'] ?? [];
            $tracking = $data['tracking'] ?? [];

            return [
                'event' => 'order.tracking.updated',
                'data' => [
                    'order_id' => $order['external_order_id'] ?? ($order['id'] ?? null),
                    'tracking_code' => $tracking['tracking_code'] ?? null,
                    'tracking_url' => $tracking['tracking_url'] ?? null,
                    'carrier' => $tracking['carrier'] ?? null,
                    'status' => $tracking['status'] ?? null,
                ],
            ];
        }

        if ($event_type === 'order.cancelled') {
            $order = $data['order'] ?? [];
            return [
                'event' => 'order.cancelled',
                'data' => [
                    'order_id' => $order['external_order_id'] ?? ($order['id'] ?? null),
                    'reason' => $order['cancellation_reason'] ?? ($order['reason'] ?? null),
                ],
            ];
        }

        return $body;
    }

    public function normalize_payload_for_test(array $body): array {
        return $this->normalize_payload($body);
    }

    /**
     * Update tracking metadata on the matching WC order.
     */
    private function handle_tracking_updated(array $data): \WP_REST_Response {
        $order_id = $data['order_id'] ?? null;
        $tracking_code = $data['tracking_code'] ?? null;

        if (empty($order_id)) {
            return new \WP_REST_Response(['error' => 'missing_order_id'], 400);
        }

        $wc_order = $this->find_order_by_merchant_id($order_id);
        if (!$wc_order) {
            return new \WP_REST_Response(['error' => 'order_not_found'], 404);
        }

        if (!empty($tracking_code)) {
            $wc_order->update_meta_data('_zyon_tracking_code', sanitize_text_field($tracking_code));
        }
        if (!empty($data['tracking_url'])) {
            $wc_order->update_meta_data('_zyon_tracking_url', esc_url_raw($data['tracking_url']));
        }
        if (!empty($data['carrier'])) {
            $wc_order->update_meta_data('_zyon_carrier', sanitize_text_field($data['carrier']));
        }
        $wc_order->save();

        return new \WP_REST_Response([
            'ok' => true,
            'order_id' => $wc_order->get_id(),
            'tracking_code' => $tracking_code,
        ], 200);
    }

    /**
     * Handle order.paid: update WC order to processing
     */
    private function handle_order_paid(array $data): \WP_REST_Response {
        $order_id = $data['order_id'] ?? null;
        $transaction_id = $data['transaction_id'] ?? null;
        $amount = $data['amount'] ?? null;
        $tracking_code = $data['tracking_code'] ?? null;

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
        if (!empty($tracking_code)) {
            $wc_order->update_meta_data('_zyon_tracking_code', sanitize_text_field($tracking_code));
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
