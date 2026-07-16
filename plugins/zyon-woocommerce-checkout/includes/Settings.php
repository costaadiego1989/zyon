<?php
namespace Zyon;

/**
 * Admin Settings Page for Zyon Checkout Plugin
 */
class Settings {
    private const OPTION_GROUP = 'zyon_checkout';
    private const MENU_SLUG = 'zyon-settings';

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
        register_setting(self::OPTION_GROUP, 'zyon_merchant_id', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => '',
        ]);

        register_setting(self::OPTION_GROUP, 'zyon_api_key', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => '',
        ]);

        register_setting(self::OPTION_GROUP, 'zyon_api_url', [
            'type' => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default' => 'http://localhost:3000',
        ]);

        register_setting(self::OPTION_GROUP, 'zyon_webhook_secret', [
            'type' => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default' => '',
        ]);

        add_settings_section(
            'zyon_main',
            'Zyon API Configuration',
            null,
            self::MENU_SLUG
        );

        add_settings_field('zyon_merchant_id', 'Merchant ID', [$this, 'render_text_field'], self::MENU_SLUG, 'zyon_main', ['label_for' => 'zyon_merchant_id', 'description' => 'Your Zyon merchant ID (e.g., mrc_xxx)']);
        add_settings_field('zyon_api_key', 'API Key', [$this, 'render_text_field'], self::MENU_SLUG, 'zyon_main', ['label_for' => 'zyon_api_key', 'description' => 'Your Zyon API key for embed session tokens']);
        add_settings_field('zyon_api_url', 'API URL', [$this, 'render_text_field'], self::MENU_SLUG, 'zyon_main', ['label_for' => 'zyon_api_url', 'description' => 'Zyon API endpoint (default: http://localhost:3000)']);
        add_settings_field('zyon_webhook_secret', 'Webhook Secret', [$this, 'render_text_field'], self::MENU_SLUG, 'zyon_main', ['label_for' => 'zyon_webhook_secret', 'description' => 'HMAC secret for verifying Zyon webhook signatures']);
    }

    public function render_text_field(array $args): void {
        $option = get_option($args['label_for'], '');
        $type = strpos($args['label_for'], 'secret') !== false || strpos($args['label_for'], 'key') !== false ? 'password' : 'text';
        printf(
            '<input type="%s" id="%s" name="%s" value="%s" class="regular-text" /><p class="description">%s</p>',
            esc_attr($type),
            esc_attr($args['label_for']),
            esc_attr($args['label_for']),
            esc_attr($option),
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
}
