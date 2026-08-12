<?php
namespace Zyon;

/**
 * Fetches embed session tokens and widget configuration from Zyon API.
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

    private const CACHE_KEY = 'zyon_embed_token';
    private const CONFIG_CACHE_KEY = 'zyon_widget_config';
    private const CACHE_TTL = 720; // 12 minutes (token TTL = 15min, refresh 3min before expiry)

    /**
     * Request a new embed session token from Zyon API.
     * Caches for 12 minutes to avoid per-page-load API calls.
     */
    public function fetch(): ?string {
        $session = $this->fetch_session();
        return $session['token'] ?? null;
    }

    /**
     * Get widget configuration (brand, agent) from cached API response.
     * Returns null if no config available.
     */
    public function widget_config(): ?array {
        $cached = get_transient(self::CONFIG_CACHE_KEY);
        if (is_array($cached)) {
            return $cached;
        }
        // Force a fetch to populate config cache
        $this->fetch_session();
        $config = get_transient(self::CONFIG_CACHE_KEY);
        return is_array($config) ? $config : null;
    }

    /**
     * Fetches full embed session (token + widget_config).
     * Returns ['token' => string|null, 'widget_config' => array|null]
     */
    private function fetch_session(): array {
        if (!$this->has_required_config()) {
            return ['token' => null, 'widget_config' => null];
        }

        // Return cached token if still valid
        $cached_token = get_transient(self::CACHE_KEY);
        if (is_string($cached_token) && $cached_token !== '') {
            $cached_config = get_transient(self::CONFIG_CACHE_KEY);
            return ['token' => $cached_token, 'widget_config' => is_array($cached_config) ? $cached_config : null];
        }

        $result = HttpClient::post($this->endpoint(), $this->headers(), $this->body());

        if ($result['error'] !== null) {
            $this->log('Embed token fetch failed: ' . $result['error']);
            return ['token' => null, 'widget_config' => null];
        }

        $body = json_decode((string) $result['body'], true);
        $token = is_array($body) ? ($body['embed_session_token'] ?? null) : null;
        $widget_config = is_array($body) ? ($body['widget_config'] ?? null) : null;

        if ($token) {
            set_transient(self::CACHE_KEY, $token, self::CACHE_TTL);
        }
        if (is_array($widget_config)) {
            set_transient(self::CONFIG_CACHE_KEY, $widget_config, self::CACHE_TTL);
        }

        return ['token' => $token, 'widget_config' => $widget_config];
    }

    private function has_required_config(): bool {
        return $this->api_url !== '' && $this->api_key !== '' && $this->merchant_id !== '';
    }

    private function endpoint(): string {
        return rtrim($this->api_url, '/') . '/v1/embed-sessions';
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

    private function log(string $message): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning('[Zyon] ' . $message, ['source' => 'zyon-checkout']);
            return;
        }
        error_log('[Zyon] ' . $message);
    }
}
