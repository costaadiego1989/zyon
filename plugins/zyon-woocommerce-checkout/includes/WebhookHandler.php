<?php
namespace Zyon;
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

/**
 * Handles incoming webhooks from Zyon API.
 */
class WebhookHandler {
    private const NAMESPACE = 'zyon/v1';
    private const ROUTE = '/webhook';
    private const MAX_TIMESTAMP_AGE_SECONDS = 300;

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
     * Verify HMAC signature from Zyon.
     */
    public function verify_hmac_signature(\WP_REST_Request $request) {
        $secret = get_option('zyon_webhook_secret', '');
        if (empty($secret)) {
            return $this->deny('Webhook secret is not configured');
        }
        if (!$this->is_fresh_timestamp($request)) {
            return $this->deny('Webhook timestamp is stale');
        }
        if ($this->verify_aacp_signature($request, (string) $secret)) {
            return true;
        }
        if ($this->verify_legacy_signature($request, (string) $secret)) {
            return true;
        }
        return $this->deny('Webhook signature verification failed');
    }

    /**
     * Handle incoming webhook event.
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

        return $this->dispatch_event((string) $body['event'], $body['data'] ?? []);
    }

    public function normalize_payload(array $body): array {
        if (isset($body['event'])) {
            return $body;
        }
        if (($body['event_type'] ?? '') === 'order.approved') {
            return $this->normalize_order_approved($body);
        }
        if (($body['event_type'] ?? '') === 'order.tracking.updated') {
            return $this->normalize_tracking_updated($body);
        }
        if (($body['event_type'] ?? '') === 'order.cancelled') {
            return $this->normalize_order_cancelled($body);
        }
        return $body;
    }

    public function normalize_payload_for_test(array $body): array {
        return $this->normalize_payload($body);
    }

    private function dispatch_event(string $event, array $data): \WP_REST_Response {
        switch ($event) {
            case 'order.paid':
                return $this->handle_order_paid($data);
            case 'order.cancelled':
                return $this->handle_order_cancelled($data);
            case 'order.tracking.updated':
            case 'order.shipped':
                return $this->handle_tracking_updated($data);
            default:
                return new \WP_REST_Response(['error' => 'unknown_event'], 400);
        }
    }

    private function is_fresh_timestamp(\WP_REST_Request $request): bool {
        $timestamp = $request->get_header('x-aacp-timestamp');
        if (empty($timestamp)) {
            return true;
        }
        $time = is_numeric($timestamp) ? (int) $timestamp : strtotime((string) $timestamp);
        return $time !== false && $time >= time() - self::MAX_TIMESTAMP_AGE_SECONDS;
    }

    private function verify_aacp_signature(\WP_REST_Request $request, string $secret): bool {
        $signature = $request->get_header('x-aacp-signature');
        $timestamp = $request->get_header('x-aacp-timestamp');
        if (empty($signature) || empty($timestamp)) {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $request->get_body(), $secret);
        return hash_equals($expected, (string) $signature);
    }

    private function verify_legacy_signature(\WP_REST_Request $request, string $secret): bool {
        $signature = $request->get_header('x-zyon-signature');
        if (empty($signature)) {
            return false;
        }
        $expected = hash_hmac('sha256', $request->get_body(), $secret);
        return hash_equals($expected, (string) $signature);
    }

    private function deny(string $reason): \WP_Error {
        $this->log($reason);
        return new \WP_Error('zyon_webhook_forbidden', 'Forbidden', ['status' => 403]);
    }

    private function normalize_order_approved(array $body): array {
        $data = $body['data'] ?? [];
        $order = $data['order'] ?? [];
        $payment = $data['payment'] ?? [];
        $tracking = $data['tracking'] ?? [];
        return ['event' => 'order.paid', 'data' => $this->paid_data($order, $payment, $tracking)];
    }

    private function paid_data(array $order, array $payment, array $tracking): array {
        return [
            'order_id' => $order['external_order_id'] ?? ($order['id'] ?? null),
            'transaction_id' => $payment['provider_reference'] ?? ($order['external_order_id'] ?? null),
            'amount' => isset($payment['amount']) ? ((float) $payment['amount']) / 100 : null,
            'currency' => $payment['currency'] ?? ($order['currency'] ?? null),
            'tracking_code' => $tracking['tracking_code'] ?? null,
        ];
    }

    private function normalize_tracking_updated(array $body): array {
        $data = $body['data'] ?? [];
        $order = $data['order'] ?? [];
        $tracking = $data['tracking'] ?? [];
        return ['event' => 'order.tracking.updated', 'data' => $this->tracking_data($order, $tracking)];
    }

    private function tracking_data(array $order, array $tracking): array {
        return [
            'order_id' => $order['external_order_id'] ?? ($order['id'] ?? null),
            'tracking_code' => $tracking['tracking_code'] ?? null,
            'tracking_url' => $tracking['tracking_url'] ?? null,
            'carrier' => $tracking['carrier'] ?? null,
            'status' => $tracking['status'] ?? null,
        ];
    }

    private function normalize_order_cancelled(array $body): array {
        $order = $body['data']['order'] ?? [];
        return [
            'event' => 'order.cancelled',
            'data' => [
                'order_id' => $order['external_order_id'] ?? ($order['id'] ?? null),
                'reason' => $order['cancellation_reason'] ?? ($order['reason'] ?? null),
            ],
        ];
    }

    private function handle_tracking_updated(array $data): \WP_REST_Response {
        $wc_order = $this->order_or_error($data['order_id'] ?? null);
        if ($wc_order instanceof \WP_REST_Response) {
            return $wc_order;
        }
        $this->apply_tracking_meta($wc_order, $data);
        $wc_order->save();
        return new \WP_REST_Response(['ok' => true, 'order_id' => $wc_order->get_id()], 200);
    }

    private function handle_order_paid(array $data): \WP_REST_Response {
        $wc_order = $this->order_or_error($data['order_id'] ?? null);
        if ($wc_order instanceof \WP_REST_Response) {
            return $wc_order;
        }
        $this->mark_order_paid($wc_order, $data);
        return new \WP_REST_Response(['ok' => true, 'order_id' => $wc_order->get_id(), 'status' => 'processing'], 200);
    }

    private function handle_order_cancelled(array $data): \WP_REST_Response {
        $wc_order = $this->order_or_error($data['order_id'] ?? null);
        if ($wc_order instanceof \WP_REST_Response) {
            return $wc_order;
        }
        $wc_order->set_status('cancelled');
        $wc_order->save();
        return new \WP_REST_Response(['ok' => true], 200);
    }

    private function order_or_error($order_id) {
        if (empty($order_id)) {
            return new \WP_REST_Response(['error' => 'missing_order_id'], 400);
        }
        $wc_order = $this->find_order_by_merchant_id((string) $order_id);
        return $wc_order ?: new \WP_REST_Response(['error' => 'order_not_found'], 404);
    }

    private function mark_order_paid(\WC_Order $wc_order, array $data): void {
        if (!empty($data['transaction_id'])) {
            $wc_order->set_transaction_id((string) $data['transaction_id']);
        }
        $this->apply_tracking_meta($wc_order, $data);
        $wc_order->set_status('processing');
        $wc_order->save();
    }

    private function apply_tracking_meta(\WC_Order $order, array $data): void {
        $this->update_text_meta($order, '_zyon_tracking_code', $data['tracking_code'] ?? null);
        $this->update_url_meta($order, '_zyon_tracking_url', $data['tracking_url'] ?? null);
        $this->update_text_meta($order, '_zyon_carrier', $data['carrier'] ?? null);
    }

    private function update_text_meta(\WC_Order $order, string $key, $value): void {
        if (!empty($value)) {
            $order->update_meta_data($key, sanitize_text_field((string) $value));
        }
    }

    private function update_url_meta(\WC_Order $order, string $key, $value): void {
        if (!empty($value)) {
            $order->update_meta_data($key, esc_url_raw((string) $value));
        }
    }

    private function find_order_by_merchant_id(string $merchant_order_id): ?\WC_Order {
        $orders = wc_get_orders(['meta_key' => '_zyon_merchant_order_id', 'meta_value' => $merchant_order_id, 'limit' => 1]);
        return !empty($orders) ? $orders[0] : null;
    }

    private function log(string $message): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning('[Zyon] ' . $message, ['source' => 'zyon-checkout-webhook']);
            return;
        }
        error_log('[Zyon] ' . $message);
    }
}
