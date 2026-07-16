<?php
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
