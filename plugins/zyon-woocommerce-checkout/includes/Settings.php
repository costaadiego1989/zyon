<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
namespace Zyon;

/**
 * Admin Settings Page for Zyon Checkout Plugin.
 */
class Settings {
    private const OPTION_GROUP = 'zyon_checkout';
    private const MENU_SLUG = 'zyon-settings';
    private const SECRET_OPTIONS = ['zyon_api_key', 'zyon_webhook_secret'];

    public function __construct() {
        add_action('admin_menu', [$this, 'add_menu_page']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_ajax_zyon_test_connection', [$this, 'handle_test_connection']);
    }

    public function handle_test_connection(): void {
        check_ajax_referer('zyon_test_connection');
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => 'Permission denied'], 403);
        }

        $api_url = trim((string) get_option('zyon_api_url', ''));
        $api_key = (string) get_option('zyon_api_key', '');

        if ($api_url === '' || $api_key === '') {
            wp_send_json_error(['message' => 'API URL and API Key must be configured first.']);
        }

        $result = HttpClient::post(
            rtrim($api_url, '/') . '/v1/embed-sessions',
            ['Content-Type' => 'application/json', 'x-aacp-api-key' => $api_key, 'Idempotency-Key' => 'test_conn_' . wp_generate_uuid4()],
            ['ttl_seconds' => 60, 'allowed_origin' => home_url(), 'scopes' => ['checkout:start']]
        );

        if ($result['error'] !== null) {
            wp_send_json_error(['message' => 'Connection failed: ' . $result['error']]);
        }

        if ($result['code'] >= 200 && $result['code'] < 300) {
            wp_send_json_success(['message' => 'Connected successfully! Token received (HTTP ' . $result['code'] . ')']);
        }

        $body = json_decode((string) $result['body'], true);
        $detail = is_array($body) ? ($body['detail'] ?? $body['message'] ?? 'Unknown error') : 'HTTP ' . $result['code'];
        wp_send_json_error(['message' => 'API returned error: ' . $detail]);
    }

    public function add_menu_page(): void {
        add_submenu_page(
            'woocommerce',
            'Zyon Checkout',
            'Zyon Checkout',
            'manage_woocommerce',
            self::MENU_SLUG,
            [$this, 'render_settings_page']
        );
    }

    public function register_settings(): void {
        $this->register_string_setting('zyon_merchant_id', [$this, 'sanitize_merchant_id']);
        $this->register_string_setting('zyon_api_key', $this->secret_sanitizer('zyon_api_key'));
        $this->register_string_setting('zyon_api_url', [$this, 'sanitize_url']);
        $this->register_string_setting('zyon_widget_url', [$this, 'sanitize_url']);
        $this->register_string_setting('zyon_browser_api_url', [$this, 'sanitize_url']);
        $this->register_string_setting('zyon_store_logo_url', [$this, 'sanitize_url']);
        $this->register_string_setting('zyon_accent_color', [$this, 'sanitize_color']);
        $this->register_string_setting('zyon_webhook_secret', $this->secret_sanitizer('zyon_webhook_secret'));
        $this->add_settings_fields();
    }

    public function sanitize_merchant_id($value): string {
        return sanitize_text_field(trim((string) $value));
    }

    public function sanitize_url($value): string {
        $url = esc_url_raw(trim((string) $value));
        if ($url === '' || $this->is_valid_config_url($url)) {
            return $url;
        }

        add_settings_error(
            'zyon_checkout',
            'zyon_https_required',
            'Zyon URLs must start with https:// unless ZYON_DEV_MODE is enabled.',
            'error'
        );
        return '';
    }

    public function sanitize_color($value): string {
        $color = sanitize_hex_color(trim((string) $value));
        return $color ?: '';
    }

    public function render_text_field(array $args): void {
        $key = (string) $args['label_for'];
        $is_secret = in_array($key, self::SECRET_OPTIONS, true);
        $value = $is_secret ? '' : (string) get_option($key, '');
        $placeholder = $this->field_placeholder($key, $is_secret);

        printf(
            '<input type="%s" id="%s" name="%s" value="%s" placeholder="%s" class="regular-text" autocomplete="new-password" /><p class="description">%s</p>',
            esc_attr($is_secret ? 'password' : 'text'),
            esc_attr($key),
            esc_attr($key),
            esc_attr($value),
            esc_attr($placeholder),
            esc_html($args['description'] ?? '')
        );
    }

    public function render_settings_page(): void {
        if (!current_user_can('manage_woocommerce')) {
            return;
        }

        echo '<div class="wrap">';
        echo '<h1>Zyon Agentic Checkout Settings</h1>';
        echo '<form method="post" action="options.php">';
        settings_fields(self::OPTION_GROUP);
        do_settings_sections(self::MENU_SLUG);
        submit_button('Save Settings');
        echo '</form>';
        $this->render_test_connection_button();
        echo '</div>';
    }

    private function render_test_connection_button(): void {
        $nonce = wp_create_nonce('zyon_test_connection');
        echo '<hr><h2>Connection Test</h2>';
        echo '<p>Verify that the plugin can reach the Zyon API with your current settings.</p>';
        echo '<button type="button" class="button button-secondary" id="zyon-test-conn">Test Connection</button>';
        echo '<span id="zyon-test-result" style="margin-left:12px;"></span>';
        wp_enqueue_script('zyonagch-admin-settings', plugins_url('../assets/js/admin-settings.js', __FILE__), [], '1.0.0', true);
        wp_localize_script('zyonagch-admin-settings', 'zyonagchAdmin', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => $nonce,
        ]);
    }

    private function register_string_setting(string $name, callable $sanitize_callback): void {
        register_setting(self::OPTION_GROUP, $name, [
            'type' => 'string',
            'sanitize_callback' => $sanitize_callback,
            'default' => '',
        ]);
    }

    private function secret_sanitizer(string $option): callable {
        return static function ($value) use ($option): string {
            $raw = (string) $value;
            $sanitized = preg_replace('/[^\x20-\x7E]/', '', $raw);
            return $sanitized === '' ? (string) get_option($option, '') : $sanitized;
        };
    }

    private function add_settings_fields(): void {
        add_settings_section('zyon_main', 'Zyon API Configuration', null, self::MENU_SLUG);
        $this->add_field('zyon_merchant_id', 'Merchant ID', 'Your Zyon merchant ID (e.g., mrc_xxx)');
        $this->add_field('zyon_api_key', 'API Key', 'Your Zyon API key for embed session tokens');
        $this->add_field('zyon_api_url', 'API URL', 'Zyon server API endpoint, e.g. https://api.zyon.ai');
        $this->add_field('zyon_widget_url', 'Widget URL', 'Optional full widget JavaScript URL. Leave blank to derive from API URL.');
        $this->add_field('zyon_browser_api_url', 'Browser API URL', 'Optional browser-facing API URL. Leave blank to use API URL.');
        $this->add_field('zyon_store_logo_url', 'Store Logo URL', 'Optional logo URL shown in the native checkout header. Leave blank to use store initial.');
        $this->add_field('zyon_accent_color', 'Accent Color', 'Optional theme color for native widget controls (hex, e.g. #0f766e).');
        $this->add_field('zyon_webhook_secret', 'Webhook Secret', 'HMAC secret for verifying Zyon webhook signatures');
    }

    private function add_field(string $key, string $title, string $description): void {
        add_settings_field(
            $key,
            $title,
            [$this, 'render_text_field'],
            self::MENU_SLUG,
            'zyon_main',
            ['label_for' => $key, 'description' => $description]
        );
    }

    private function field_placeholder(string $key, bool $is_secret): string {
        if (!$is_secret || get_option($key, '') === '') {
            return '';
        }
        return 'Configured — leave blank to keep existing';
    }

    private function is_valid_config_url(string $url): bool {
        if (defined('ZYON_DEV_MODE') && ZYON_DEV_MODE) {
            return (bool) wp_http_validate_url($url);
        }
        return strpos($url, 'https://') === 0 && (bool) wp_http_validate_url($url);
    }
}
