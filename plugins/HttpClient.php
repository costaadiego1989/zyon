<?php
namespace Zyon;

/**
 * Resilient HTTP client for Zyon API calls.
 * Features:
 *   - Configurable timeout (default 8s)
 *   - Retry with exponential backoff (max 2 retries)
 *   - Circuit breaker: after N consecutive failures, skip calls for a cooldown period
 */
class HttpClient {
    private const CIRCUIT_FAILURES_THRESHOLD = 3;
    private const CIRCUIT_COOLDOWN_SECONDS = 60;
    private const TRANSIENT_OPTION = 'zyon_circuit_state';
    private const MAX_RETRIES = 2;
    private const DEFAULT_TIMEOUT = 8;

    /**
     * Make a POST request with retry and circuit breaker.
     *
     * @param string $url Endpoint URL.
     * @param array $headers Request headers.
     * @param array|string $body JSON body (array will be encoded).
     * @param int $timeout Timeout in seconds.
     * @return array{code: int, body: string|null, error: string|null}
     */
    public static function post(string $url, array $headers = [], $body = '', int $timeout = self::DEFAULT_TIMEOUT): array {
        if (self::circuit_is_open()) {
            return ['code' => 0, 'body' => null, 'error' => 'Circuit breaker open — API calls paused for cooldown.'];
        }

        $encoded_body = is_array($body) ? wp_json_encode($body) : $body;
        $args = [
            'headers' => $headers,
            'body' => $encoded_body,
            'timeout' => $timeout,
        ];

        $last_error = '';
        for ($attempt = 0; $attempt <= self::MAX_RETRIES; $attempt++) {
            if ($attempt > 0) {
                usleep(min(500000 * (2 ** ($attempt - 1)), 2000000)); // 500ms, 1s
            }

            $response = wp_remote_post($url, $args);

            if (is_wp_error($response)) {
                $last_error = $response->get_error_message();
                // Retry on transient errors
                if (self::is_retryable_error($response)) {
                    continue;
                }
                break;
            }

            $code = (int) wp_remote_retrieve_response_code($response);

            // Success
            if ($code >= 200 && $code < 300) {
                self::circuit_record_success();
                return ['code' => $code, 'body' => wp_remote_retrieve_body($response), 'error' => null];
            }

            // Retryable server errors
            if ($code >= 500 || $code === 429) {
                $last_error = "HTTP $code";
                continue;
            }

            // Client error — don't retry
            self::circuit_record_success(); // not a transient failure
            return ['code' => $code, 'body' => wp_remote_retrieve_body($response), 'error' => "HTTP $code"];
        }

        // All retries exhausted
        self::circuit_record_failure();
        self::log("API call failed after retries: $url — $last_error");
        return ['code' => 0, 'body' => null, 'error' => $last_error];
    }

    private static function is_retryable_error($wp_error): bool {
        $msg = $wp_error->get_error_message();
        return stripos($msg, 'timed out') !== false
            || stripos($msg, 'connection') !== false
            || stripos($msg, 'resolve') !== false;
    }

    private static function circuit_is_open(): bool {
        $state = get_transient(self::TRANSIENT_OPTION);
        if (!is_array($state)) return false;
        return ($state['failures'] ?? 0) >= self::CIRCUIT_FAILURES_THRESHOLD
            && (time() - ($state['last_failure'] ?? 0)) < self::CIRCUIT_COOLDOWN_SECONDS;
    }

    private static function circuit_record_failure(): void {
        $state = get_transient(self::TRANSIENT_OPTION) ?: ['failures' => 0, 'last_failure' => 0];
        $state['failures'] = ($state['failures'] ?? 0) + 1;
        $state['last_failure'] = time();
        set_transient(self::TRANSIENT_OPTION, $state, self::CIRCUIT_COOLDOWN_SECONDS * 2);
    }

    private static function circuit_record_success(): void {
        delete_transient(self::TRANSIENT_OPTION);
    }

    private static function log(string $message): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning('[Zyon] ' . $message, ['source' => 'zyon-checkout']);
            return;
        }
        error_log('[Zyon] ' . $message);
    }
}
