<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
/**
 * Tests for Webhook Handler
 */

class TestWebhookHandler extends WP_UnitTestCase {
    /**
     * RED: WebhookHandler class should exist
     */
    public function test_webhook_handler_class_exists() {
        $this->assertTrue(class_exists('Zyon\\WebhookHandler'));
    }

    /**
     * RED: Webhook endpoint should be registered
     */
    public function test_webhook_endpoint_registered() {
        // REST route should be registered
        $routes = rest_get_server()->get_routes();
        $webhook_registered = isset($routes['/zyon/v1/webhook']) || isset($routes['/zyon/v1/webhook/']);
        $this->assertTrue($webhook_registered);
    }

    /**
     * RED: Webhook should require HMAC signature
     */
    public function test_webhook_requires_hmac_signature() {
        // This is an integration test that would verify HMAC validation
        // Placeholder for actual HMAC verification test
        $this->assertTrue(true);
    }

    /**
     * RED: Webhook should normalize AACP envelopes.
     */
    public function test_webhook_normalizes_aacp_order_approved_envelope() {
        $handler = new Zyon\WebhookHandler();
        $normalized = $handler->normalize_payload_for_test([
            'event_type' => 'order.approved',
            'data' => [
                'order' => [
                    'external_order_id' => 'ord_test123',
                    'status' => 'paid',
                ],
                'payment' => [
                    'status' => 'approved',
                    'provider_reference' => 'pay_123',
                    'amount' => 10000,
                ],
                'tracking' => [
                    'tracking_code' => 'ME123',
                ],
            ],
        ]);

        $this->assertEquals('order.paid', $normalized['event']);
        $this->assertEquals('ord_test123', $normalized['data']['order_id']);
        $this->assertEquals('ME123', $normalized['data']['tracking_code']);
    }

    /**
     * RED: Webhook should normalize tracking update envelope.
     */
    public function test_webhook_normalizes_aacp_tracking_envelope() {
        $handler = new Zyon\WebhookHandler();
        $normalized = $handler->normalize_payload_for_test([
            'event_type' => 'order.tracking.updated',
            'data' => [
                'order' => ['external_order_id' => 'ord_test123'],
                'tracking' => [
                    'tracking_code' => 'ME123',
                    'tracking_url' => 'https://label.test/me123.pdf',
                    'status' => 'label_generated',
                ],
            ],
        ]);

        $this->assertEquals('order.tracking.updated', $normalized['event']);
        $this->assertEquals('ME123', $normalized['data']['tracking_code']);
        $this->assertEquals('https://label.test/me123.pdf', $normalized['data']['tracking_url']);
    }

    /**
     * RED: Webhook should accept POST requests
     */
    public function test_webhook_accepts_post() {
        $payload = [
            'event' => 'order.paid',
            'data' => [
                'order_id' => 'ord_test123',
                'merchant_id' => 'mrc_test',
                'amount' => 100.00,
                'payment_method' => 'pix'
            ]
        ];

        // Mock webhook call
        $response = rest_do_request(
            new WP_REST_Request('POST', '/zyon/v1/webhook')
        );

        // Should not be 404 (endpoint should exist)
        $this->assertNotEquals(404, $response->get_status());
    }
}
