<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
/**
 * Tests for Zyon\HttpClient (retry + circuit breaker).
 */

class TestHttpClient extends WP_UnitTestCase {

    public function setUp(): void {
        parent::setUp();
        // Reset circuit breaker state between tests
        delete_transient('zyon_circuit_state');
    }

    public function test_http_client_class_exists(): void {
        $this->assertTrue(class_exists('Zyon\HttpClient'));
    }

    public function test_successful_post_returns_code_and_body(): void {
        // Mock a successful endpoint (use WordPress built-in test server or hook)
        add_filter('pre_http_request', function ($pre, $args, $url) {
            if (strpos($url, 'https://mock-success.test') !== false) {
                return [
                    'response' => ['code' => 200, 'message' => 'OK'],
                    'body' => '{"token":"tok_test"}',
                    'headers' => [],
                ];
            }
            return $pre;
        }, 10, 3);

        $result = Zyon\HttpClient::post(
            'https://mock-success.test/v1/embed-sessions',
            ['Content-Type' => 'application/json'],
            ['ttl_seconds' => 900]
        );

        $this->assertEquals(200, $result['code']);
        $this->assertStringContainsString('tok_test', $result['body']);
        $this->assertNull($result['error']);
    }

    public function test_server_error_triggers_retry(): void {
        $call_count = 0;

        add_filter('pre_http_request', function ($pre, $args, $url) use (&$call_count) {
            if (strpos($url, 'https://mock-retry.test') !== false) {
                $call_count++;
                // First 2 calls: 500, third: 200
                if ($call_count <= 2) {
                    return ['response' => ['code' => 500, 'message' => 'Internal'], 'body' => '', 'headers' => []];
                }
                return ['response' => ['code' => 200, 'message' => 'OK'], 'body' => '{"ok":true}', 'headers' => []];
            }
            return $pre;
        }, 10, 3);

        $result = Zyon\HttpClient::post(
            'https://mock-retry.test/api',
            ['Content-Type' => 'application/json'],
            ['data' => 'test']
        );

        // Should succeed on third attempt
        $this->assertEquals(200, $result['code']);
        $this->assertEquals(3, $call_count);
    }

    public function test_client_error_does_not_retry(): void {
        $call_count = 0;

        add_filter('pre_http_request', function ($pre, $args, $url) use (&$call_count) {
            if (strpos($url, 'https://mock-client-error.test') !== false) {
                $call_count++;
                return ['response' => ['code' => 401, 'message' => 'Unauthorized'], 'body' => '{"error":"invalid_key"}', 'headers' => []];
            }
            return $pre;
        }, 10, 3);

        $result = Zyon\HttpClient::post(
            'https://mock-client-error.test/api',
            ['Content-Type' => 'application/json'],
            ['data' => 'test']
        );

        // Should NOT retry on 4xx
        $this->assertEquals(401, $result['code']);
        $this->assertEquals(1, $call_count);
        $this->assertEquals('HTTP 401', $result['error']);
    }

    public function test_circuit_breaker_opens_after_consecutive_failures(): void {
        add_filter('pre_http_request', function ($pre, $args, $url) {
            if (strpos($url, 'https://mock-circuit.test') !== false) {
                return new WP_Error('http_request_failed', 'Connection timed out');
            }
            return $pre;
        }, 10, 3);

        // Trigger 3 failures (MAX_RETRIES = 2, so each post() = 3 attempts internally)
        Zyon\HttpClient::post('https://mock-circuit.test/api', [], []);
        Zyon\HttpClient::post('https://mock-circuit.test/api', [], []);
        Zyon\HttpClient::post('https://mock-circuit.test/api', [], []);

        // Circuit should now be open
        $result = Zyon\HttpClient::post('https://mock-circuit.test/api', [], []);
        $this->assertEquals(0, $result['code']);
        $this->assertStringContainsString('Circuit breaker open', $result['error']);
    }

    public function test_circuit_breaker_resets_on_success(): void {
        // Set circuit as failed
        set_transient('zyon_circuit_state', ['failures' => 5, 'last_failure' => time() - 120], 120);

        // Should be open since last_failure was 2min ago but cooldown is 60s (expired)
        // Actually: 120 > 60, so circuit should be CLOSED again
        add_filter('pre_http_request', function ($pre, $args, $url) {
            if (strpos($url, 'https://mock-reset.test') !== false) {
                return ['response' => ['code' => 200, 'message' => 'OK'], 'body' => '{"ok":true}', 'headers' => []];
            }
            return $pre;
        }, 10, 3);

        $result = Zyon\HttpClient::post('https://mock-reset.test/api', [], []);
        $this->assertEquals(200, $result['code']);

        // Circuit should be reset
        $this->assertFalse(get_transient('zyon_circuit_state'));
    }

    public function test_rate_limit_429_triggers_retry(): void {
        $call_count = 0;

        add_filter('pre_http_request', function ($pre, $args, $url) use (&$call_count) {
            if (strpos($url, 'https://mock-ratelimit.test') !== false) {
                $call_count++;
                if ($call_count === 1) {
                    return ['response' => ['code' => 429, 'message' => 'Too Many'], 'body' => '', 'headers' => []];
                }
                return ['response' => ['code' => 200, 'message' => 'OK'], 'body' => '{"ok":true}', 'headers' => []];
            }
            return $pre;
        }, 10, 3);

        $result = Zyon\HttpClient::post('https://mock-ratelimit.test/api', [], []);
        $this->assertEquals(200, $result['code']);
        $this->assertGreaterThan(1, $call_count);
    }
}
