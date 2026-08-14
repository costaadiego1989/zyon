<?php
namespace Zyon;
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

/**
 * Syncs WooCommerce order events to Zyon API.
 */
class OrderSync {
    public function __construct() {
        add_action('woocommerce_payment_complete', [$this, 'on_payment_complete']);
        add_action('woocommerce_order_status_changed', [$this, 'on_status_changed'], 10, 4);
    }

    public function on_payment_complete(int $order_id): void {
        $order = wc_get_order($order_id);
        if (!$order || $order->get_meta('_zyon_payment_synced') === 'yes') {
            return;
        }

        $this->notify_zyon('order.payment_confirmed', $this->payment_payload($order_id, $order));
        $order->update_meta_data('_zyon_payment_synced', 'yes');
        $order->save();
    }

    public function on_status_changed(int $order_id, string $from, string $to, \WC_Order $order): void {
        if (!in_array($to, ['cancelled', 'refunded', 'completed'], true)) {
            return;
        }
        $this->notify_zyon('order.status_changed', $this->status_payload($order_id, $from, $to));
    }

    private function payment_payload(int $order_id, \WC_Order $order): array {
        return [
            'wc_order_id' => $order_id,
            'transaction_id' => $order->get_transaction_id(),
            'total' => (float) $order->get_total(),
            'currency' => $order->get_currency(),
            'status' => $order->get_status(),
        ];
    }

    private function status_payload(int $order_id, string $from, string $to): array {
        return ['wc_order_id' => $order_id, 'from_status' => $from, 'to_status' => $to];
    }

    private function notify_zyon(string $event, array $data): void {
        $config = $this->config();
        if (!$this->has_config($config)) {
            return;
        }

        $result = HttpClient::post(
            $this->endpoint($config['api_url']),
            $this->headers($config['api_key']),
            $this->payload($config['merchant_id'], $event, $data)
        );

        if ($result['error'] !== null) {
            $this->log_sync_failure($event, $result['error']);
        }
    }

    private function log_sync_failure(string $event, string $error): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning("[Zyon] OrderSync $event failed: $error", ['source' => 'zyon-checkout']);
            return;
        }
        error_log("[Zyon] OrderSync $event failed: $error");
    }

    private function config(): array {
        return [
            'api_url' => trim((string) get_option('zyon_api_url', '')),
            'merchant_id' => trim((string) get_option('zyon_merchant_id', '')),
            'api_key' => (string) get_option('zyon_api_key', ''),
        ];
    }

    private function has_config(array $config): bool {
        return $config['api_url'] !== '' && $config['merchant_id'] !== '' && $config['api_key'] !== '';
    }

    private function endpoint(string $api_url): string {
        return rtrim($api_url, '/') . '/commerce/woocommerce/webhook';
    }

    private function request_args(array $config, string $event, array $data): array {
        return [
            'headers' => $this->headers($config['api_key']),
            'body' => wp_json_encode($this->payload($config['merchant_id'], $event, $data)),
            'timeout' => 5,
        ];
    }

    private function headers(string $api_key): array {
        return ['Content-Type' => 'application/json', 'x-aacp-api-key' => $api_key];
    }

    private function payload(string $merchant_id, string $event, array $data): array {
        return ['event' => $event, 'merchant_id' => $merchant_id, 'data' => $data, 'timestamp' => gmdate('c')];
    }

    private function log_failed_response($response, string $event): void {
        if (is_wp_error($response)) {
            $this->log('Outbound sync failed for ' . $event . ': ' . $response->get_error_message());
            return;
        }
        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            $this->log('Outbound sync returned HTTP ' . (int) $code . ' for ' . $event);
        }
    }

    private function log(string $message): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning('[Zyon] ' . $message, ['source' => 'zyon-checkout-sync']);
            return;
        }
        error_log('[Zyon] ' . $message);
    }
}
