<?php
namespace Zyon;

/**
 * Fetches embed session tokens from Zyon API.
 */
class EmbedToken {
    private string $api_url;
    private string $api_key;
    private string $merchant_id;

    public function __construct(?string $api_url = null, ?string $api_key = null, ?string $merchant_id = null) {
        $this->api_url = trim((string) ($api_url ?? get_option('zyon_api_url', '')));
        $this->api_key = (string) ($api_key ?? get_option('zyon_api_key', ''));
        $this->merchant_id = trim((string) ($merchant_id ?? get_option('zyon_merchant_id', '')));
    }

    /**
     * Request a new embed session token from Zyon API.
     */
    public function fetch(): ?string {
        if (!$this->has_required_config()) {
            return null;
        }

        $result = HttpClient::post($this->endpoint(), $this->headers(), $this->body());

        if ($result['error'] !== null) {
            $this->log('Embed token fetch failed: ' . $result['error']);
            return null;
        }

        $body = json_decode((string) $result['body'], true);
        return is_array($body) ? ($body['embed_session_token'] ?? null) : null;
    }

    private function has_required_config(): bool {
        return $this->api_url !== '' && $this->api_key !== '' && $this->merchant_id !== '';
    }

    private function endpoint(): string {
        return rtrim($this->api_url, '/') . '/v1/embed-sessions';
    }

    private function request_args(): array {
        return [
            'headers' => $this->headers(),
            'body' => wp_json_encode($this->body()),
            'timeout' => 10,
        ];
    }

    private function headers(): array {
        return [
            'Content-Type' => 'application/json',
            'x-aacp-api-key' => $this->api_key,
            'Idempotency-Key' => 'embed_' . wp_generate_uuid4(),
        ];
    }

    private function body(): array {
        return [
            'ttl_seconds' => 900,
            'allowed_origin' => home_url(),
            'scopes' => ['checkout:start', 'checkout:chat', 'payment:intents:create'],
        ];
    }

    private function token_from_response($response): ?string {
        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200 && $code !== 201) {
            $this->log('Embed token fetch returned HTTP ' . (int) $code);
            return null;
        }
        $body = json_decode(wp_remote_retrieve_body($response), true);
        return is_array($body) ? ($body['embed_session_token'] ?? null) : null;
    }

    private function log(string $message): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning('[Zyon] ' . $message, ['source' => 'zyon-checkout']);
            return;
        }
        error_log('[Zyon] ' . $message);
    }
}
