<?php
namespace Zyon;

/**
 * Fetches embed session tokens from Zyon API
 */
class EmbedToken {
    private string $api_url;
    private string $api_key;
    private string $merchant_id;

    public function __construct(?string $api_url = null, ?string $api_key = null, ?string $merchant_id = null) {
        $this->api_url = $api_url ?? get_option('zyon_api_url', 'http://localhost:3000');
        $this->api_key = $api_key ?? get_option('zyon_api_key', '');
        $this->merchant_id = $merchant_id ?? get_option('zyon_merchant_id', '');
    }

    /**
     * Request a new embed session token from Zyon API
     */
    public function fetch(): ?string {
        if (empty($this->api_key) || empty($this->merchant_id)) {
            return null;
        }

        $response = wp_remote_post(
            rtrim($this->api_url, '/') . '/embed-sessions',
            [
                'headers' => [
                    'Content-Type' => 'application/json',
                    'x-aacp-api-key' => $this->api_key,
                ],
                'body' => wp_json_encode([
                    'ttl_seconds' => 900,
                    'allowed_origin' => home_url(),
                    'scopes' => ['checkout:start', 'checkout:chat', 'payment:intents:create'],
                ]),
                'timeout' => 10,
            ]
        );

        if (is_wp_error($response)) {
            error_log('[Zyon] Embed token fetch failed: ' . $response->get_error_message());
            return null;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code !== 200 && $code !== 201) {
            error_log('[Zyon] Embed token fetch returned HTTP ' . $code);
            return null;
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        return $body['embed_session_token'] ?? null;
    }
}
