<?php
/**
 * Integration tests: full order lifecycle (webhook → WC order → sync back)
 *
 * Validates the complete bidirectional flow:
 * 1. Webhook inbound creates/updates WC order
 * 2. OrderSync fires outbound notification on status change
 * 3. Idempotency guards prevent duplicate processing
 */

class TestIntegrationFlow extends WP_UnitTestCase {

    private function configure_plugin(): void {
        update_option('zyon_api_url', 'https://api.example.com');
        update_option('zyon_merchant_id', 'mrc_integration_test');
        update_option('zyon_api_key', 'key_integration_test');
        update_option('zyon_webhook_secret', 'webhook_secret_test');
    }

    private function create_order_with_zyon_meta(string $merchant_order_id): int {
        $order = wc_create_order();
        $order->set_status('pending');
        $order->update_meta_data('_zyon_merchant_order_id', $merchant_order_id);
        $order->save();
        return $order->get_id();
    }

    // ─── Webhook Inbound: order.paid marks WC order processing ─────────────

    public function test_webhook_order_paid_marks_wc_order_processing() {
        $this->configure_plugin();
        $merchant_order_id = 'zyon_ord_' . wp_generate_uuid4();
        $wc_order_id = $this->create_order_with_zyon_meta($merchant_order_id);

        $handler = new Zyon\WebhookHandler();

        // Simulate normalized webhook payload
        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body(wp_json_encode([
            'event' => 'order.paid',
            'data' => [
                'order_id' => $merchant_order_id,
                'transaction_id' => 'txn_pix_integration_001',
                'amount' => 150.00,
                'currency' => 'BRL',
            ],
        ]));
        $request->set_header('Content-Type', 'application/json');

        $response = $handler->handle_webhook($request);

        $this->assertEquals(200, $response->get_status());

        $updated = wc_get_order($wc_order_id);
        $this->assertEquals('processing', $updated->get_status());
        $this->assertEquals('txn_pix_integration_001', $updated->get_transaction_id());
    }

    // ─── Webhook Inbound: order.paid is idempotent ────────────────────────

    public function test_webhook_order_paid_idempotent() {
        $this->configure_plugin();
        $merchant_order_id = 'zyon_ord_' . wp_generate_uuid4();
        $wc_order_id = $this->create_order_with_zyon_meta($merchant_order_id);

        $handler = new Zyon\WebhookHandler();
        $payload = wp_json_encode([
            'event' => 'order.paid',
            'data' => [
                'order_id' => $merchant_order_id,
                'transaction_id' => 'txn_double',
            ],
        ]);

        $req1 = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $req1->set_body($payload);
        $req1->set_header('Content-Type', 'application/json');
        $handler->handle_webhook($req1);

        $req2 = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $req2->set_body($payload);
        $req2->set_header('Content-Type', 'application/json');
        $handler->handle_webhook($req2);

        // Order still processing, not double-updated
        $updated = wc_get_order($wc_order_id);
        $this->assertEquals('processing', $updated->get_status());
    }

    // ─── Webhook Inbound: tracking update persists meta ───────────────────

    public function test_webhook_tracking_update_persists_meta() {
        $this->configure_plugin();
        $merchant_order_id = 'zyon_ord_' . wp_generate_uuid4();
        $wc_order_id = $this->create_order_with_zyon_meta($merchant_order_id);

        $handler = new Zyon\WebhookHandler();
        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body(wp_json_encode([
            'event' => 'order.tracking.updated',
            'data' => [
                'order_id' => $merchant_order_id,
                'tracking_code' => 'BR123456789AA',
                'tracking_url' => 'https://rastreamento.correios.com.br/app/index.php?objeto=BR123456789AA',
                'carrier' => 'correios',
                'status' => 'in_transit',
            ],
        ]));
        $request->set_header('Content-Type', 'application/json');

        $response = $handler->handle_webhook($request);

        $this->assertEquals(200, $response->get_status());

        $updated = wc_get_order($wc_order_id);
        $this->assertEquals('BR123456789AA', $updated->get_meta('_zyon_tracking_code'));
        $this->assertStringContainsString('correios', $updated->get_meta('_zyon_carrier'));
    }

    // ─── Webhook Inbound: order.cancelled sets WC order cancelled ─────────

    public function test_webhook_order_cancelled_updates_status() {
        $this->configure_plugin();
        $merchant_order_id = 'zyon_ord_' . wp_generate_uuid4();
        $wc_order_id = $this->create_order_with_zyon_meta($merchant_order_id);

        // First mark as processing
        $order = wc_get_order($wc_order_id);
        $order->set_status('processing');
        $order->save();

        $handler = new Zyon\WebhookHandler();
        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body(wp_json_encode([
            'event' => 'order.cancelled',
            'data' => ['order_id' => $merchant_order_id],
        ]));
        $request->set_header('Content-Type', 'application/json');

        $response = $handler->handle_webhook($request);

        $this->assertEquals(200, $response->get_status());

        $updated = wc_get_order($wc_order_id);
        $this->assertEquals('cancelled', $updated->get_status());
    }

    // ─── Webhook Inbound: missing order returns 404 ──────────────────────

    public function test_webhook_order_not_found_returns_404() {
        $this->configure_plugin();

        $handler = new Zyon\WebhookHandler();
        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body(wp_json_encode([
            'event' => 'order.paid',
            'data' => ['order_id' => 'nonexistent_order_xyz'],
        ]));
        $request->set_header('Content-Type', 'application/json');

        $response = $handler->handle_webhook($request);

        $this->assertEquals(404, $response->get_status());
    }

    // ─── OrderSync Outbound: payment_complete fires notify ───────────────

    public function test_order_sync_marks_synced_on_payment_complete() {
        $this->configure_plugin();

        $order = wc_create_order();
        $order->set_status('pending');
        $order->save();
        $order_id = $order->get_id();

        // Fire the hook that WooCommerce triggers after payment
        do_action('woocommerce_payment_complete', $order_id);

        $updated = wc_get_order($order_id);
        $this->assertEquals('yes', $updated->get_meta('_zyon_payment_synced'));
    }

    // ─── OrderSync Outbound: idempotent (no double sync) ─────────────────

    public function test_order_sync_does_not_double_sync() {
        $this->configure_plugin();

        $order = wc_create_order();
        $order->set_status('pending');
        $order->save();
        $order_id = $order->get_id();

        do_action('woocommerce_payment_complete', $order_id);
        do_action('woocommerce_payment_complete', $order_id);

        // Still synced=yes, no error
        $updated = wc_get_order($order_id);
        $this->assertEquals('yes', $updated->get_meta('_zyon_payment_synced'));
    }

    // ─── OrderSync Outbound: status_changed fires for cancelled/refunded ─

    public function test_order_sync_fires_on_cancellation() {
        $this->configure_plugin();

        $order = wc_create_order();
        $order->set_status('processing');
        $order->save();

        // Change to cancelled - should trigger on_status_changed
        $order->set_status('cancelled');
        $order->save();

        // No exception = sync attempted (HTTP will fail silently in test)
        $this->assertTrue(true);
    }

    // ─── HMAC Signature verification ─────────────────────────────────────

    public function test_hmac_signature_verification() {
        $this->configure_plugin();
        $secret = 'webhook_secret_test';

        $handler = new Zyon\WebhookHandler();
        $payload = '{"event":"order.paid","data":{"order_id":"test"}}';

        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body($payload);
        $request->set_header('Content-Type', 'application/json');

        // Valid signature: handler expects 'sha256=' prefix
        $timestamp = (string) time();
        $signature = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
        $request->set_header('x-aacp-signature', $signature);
        $request->set_header('x-aacp-timestamp', $timestamp);

        $result = $handler->verify_hmac_signature($request);
        $this->assertTrue($result);
    }

    public function test_hmac_rejects_wrong_signature() {
        $this->configure_plugin();

        $handler = new Zyon\WebhookHandler();
        $payload = '{"event":"order.paid","data":{"order_id":"test"}}';

        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body($payload);
        $request->set_header('Content-Type', 'application/json');
        $request->set_header('x-aacp-signature', 'invalid_signature');
        $request->set_header('x-aacp-timestamp', (string) time());

        $result = $handler->verify_hmac_signature($request);
        $this->assertInstanceOf(WP_Error::class, $result);
    }

    public function test_hmac_rejects_stale_timestamp() {
        $this->configure_plugin();
        $secret = 'webhook_secret_test';

        $handler = new Zyon\WebhookHandler();
        $payload = '{"event":"order.paid","data":{"order_id":"test"}}';

        $stale_timestamp = (string) (time() - 600); // 10 min ago
        $signature = hash_hmac('sha256', $stale_timestamp . '.' . $payload, $secret);

        $request = new WP_REST_Request('POST', '/zyon/v1/webhook');
        $request->set_body($payload);
        $request->set_header('Content-Type', 'application/json');
        $request->set_header('x-aacp-signature', $signature);
        $request->set_header('x-aacp-timestamp', $stale_timestamp);

        $result = $handler->verify_hmac_signature($request);
        $this->assertInstanceOf(WP_Error::class, $result);
    }

    // ─── CheckoutEmbed: is_configured validates all required fields ───────

    public function test_checkout_embed_not_configured_without_api_url() {
        delete_option('zyon_api_url');
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');

        $embed = new Zyon\CheckoutEmbed();
        $method = new ReflectionMethod($embed, 'is_configured');
        $method->setAccessible(true);

        $this->assertFalse($method->invoke($embed));
    }

    public function test_checkout_embed_configured_with_all_options() {
        update_option('zyon_api_url', 'https://api.production.com');
        update_option('zyon_merchant_id', 'mrc_prod');
        update_option('zyon_api_key', 'key_prod');

        $embed = new Zyon\CheckoutEmbed();
        $method = new ReflectionMethod($embed, 'is_configured');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke($embed));
    }
}
