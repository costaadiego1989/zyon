<?php
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
        echo '</div>';
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
            $sanitized = sanitize_text_field((string) $value);
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
