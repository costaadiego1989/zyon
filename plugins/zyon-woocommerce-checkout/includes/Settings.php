<?php
namespace Zyon;

if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

class Settings {
    private const OPTION_GROUP = 'zyon_checkout';
    private const MENU_SLUG = 'zyon-settings';

    public function __construct() {
        add_action('admin_menu', [$this, 'add_menu_page']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('wp_ajax_zyon_test_connection', [$this, 'handle_test_connection']);
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
        register_setting(self::OPTION_GROUP, 'zyon_api_key', [
            'type' => 'string',
            'sanitize_callback' => function ($value) {
                $raw = trim((string) $value);
                // Ignore masked value or empty (keep existing key in DB)
                if ($raw === '' || preg_match('/\x{2022}|•/u', $raw)) {
                    return (string) get_option('zyon_api_key', '');
                }
                return preg_replace('/[^\x20-\x7E]/', '', $raw);
            },
            'default' => '',
        ]);
        register_setting(self::OPTION_GROUP, 'zyon_api_url', [
            'type' => 'string',
            'sanitize_callback' => function ($value) {
                $url = esc_url_raw(trim((string) $value));
                return $url === '' ? 'https://api.zyon.dev' : $url;
            },
            'default' => 'https://api.zyon.dev',
        ]);
        register_setting(self::OPTION_GROUP, 'zyon_merchant_id', ['type' => 'string', 'sanitize_callback' => 'sanitize_text_field', 'default' => '']);
        register_setting(self::OPTION_GROUP, 'zyon_webhook_secret', [
            'type' => 'string',
            'sanitize_callback' => function ($value) {
                $raw = (string) $value;
                $sanitized = preg_replace('/[^\x20-\x7E]/', '', $raw);
                return $sanitized === '' ? (string) get_option('zyon_webhook_secret', '') : $sanitized;
            },
            'default' => '',
        ]);
        register_setting(self::OPTION_GROUP, 'zyon_widget_url', ['type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => '']);
        register_setting(self::OPTION_GROUP, 'zyon_browser_api_url', ['type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => '']);
        register_setting(self::OPTION_GROUP, 'zyon_store_logo_url', ['type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => '']);
        register_setting(self::OPTION_GROUP, 'zyon_accent_color', ['type' => 'string', 'sanitize_callback' => 'sanitize_hex_color', 'default' => '']);
    }

    public function render_settings_page(): void {
        if (!current_user_can('manage_woocommerce')) return;

        $api_key = (string) get_option('zyon_api_key', '');
        $api_url = (string) get_option('zyon_api_url', 'https://api.zyon.dev');
        $merchant_id = (string) get_option('zyon_merchant_id', '');
        $is_configured = $api_key !== '' && $merchant_id !== '';

        echo '<div class="wrap">';
        echo '<h1>Zyon AI Checkout</h1>';

        if ($is_configured) {
            echo '<div class="notice notice-success" style="border-left-color:#46b450;"><p>';
            echo '<strong>✓ Conectado</strong> — Merchant: <code>' . esc_html($merchant_id) . '</code>';
            echo '</p></div>';
        }

        echo '<form method="post" action="options.php">';
        settings_fields(self::OPTION_GROUP);

        echo '<table class="form-table"><tbody>';

        // API Key
        echo '<tr><th><label for="zyon_api_key">API Key</label></th><td>';
        $masked_key = $api_key ? substr($api_key, 0, 8) . '••••••••' . substr($api_key, -4) : '';
        printf(
            '<input type="text" id="zyon_api_key" name="zyon_api_key" value="%s" placeholder="%s" class="regular-text" />',
            esc_attr($masked_key),
            esc_attr('Cole sua API Key aqui')
        );
        if ($api_key) {
            echo '<p class="description" style="color:#46b450;">✓ API Key configurada. Cole uma nova para substituir.</p>';
        }
        echo '</td></tr>';

        // API URL
        echo '<tr><th><label for="zyon_api_url">API URL</label></th><td>';
        printf('<input type="url" id="zyon_api_url" name="zyon_api_url" value="%s" class="regular-text" />', esc_attr($api_url));
        echo '<p class="description">Padrão: https://api.zyon.dev</p>';
        echo '</td></tr>';

        echo '</tbody></table>';

        // Buttons: Test + Save
        echo '<p class="submit" style="display:flex;gap:12px;align-items:center;">';
        echo '<button type="button" class="button button-secondary" id="zyon-test-conn" style="height:36px;">Testar Conexão</button>';
        echo '<span id="zyon-test-result"></span>';
        submit_button('Salvar', 'primary', 'submit', false, ['style' => 'height:36px;']);
        echo '</p>';

        echo '</form>';

        $dashboard_url = str_replace(['api.zyon.dev', 'localhost:3009', '127.0.0.1:3009'], ['app.zyon.dev', 'localhost:5175', '127.0.0.1:5175'], $api_url);

        // Step 2: WooCommerce credentials for Zyon Dashboard
        if ($is_configured) {
            $wc_keys_url = admin_url('admin.php?page=wc-settings&tab=advanced&section=keys');

            echo '<hr style="margin:24px 0;">';
            echo '<h2 style="font-size:16px;">Etapa 2 — Sincronizar sua loja</h2>';
            echo '<p style="color:#666;margin-bottom:16px;">Conecte o catálogo e os pedidos da sua loja WooCommerce ao Zyon para o agente vender com informações reais.</p>';

            echo '<ol style="margin:12px 0 16px 20px;line-height:2.2;">';
            echo '<li>Acesse <a href="' . esc_url($wc_keys_url) . '" target="_blank"><strong>WooCommerce → Configurações → Avançado → API REST</strong></a> e crie uma nova chave com permissão <em>Leitura/Escrita</em></li>';
            echo '<li>Copie a <strong>Consumer Key</strong> e <strong>Consumer Secret</strong> geradas</li>';
            echo '<li>No <a href="' . esc_url($dashboard_url) . '" target="_blank"><strong>Dashboard Zyon</strong></a>, vá em <strong>Integrações → Conectar WooCommerce</strong> e cole as chaves</li>';
            echo '</ol>';

            echo '<p class="description">URL da sua loja: <code>' . esc_html(home_url('/')) . '</code> (necessária no dashboard)</p>';
        }

        // Dashboard link
        echo '<hr style="margin:24px 0;">';
        echo '<p style="font-size:14px;">';
        echo '🔧 Gerencie regras, personalize o agente e acompanhe pedidos no ';
        echo '<a href="' . esc_url($dashboard_url) . '" target="_blank" style="font-weight:600;">Dashboard Zyon →</a>';
        echo '</p>';

        // Enqueue test script
        wp_enqueue_script('zyonagch-admin-settings', plugins_url('../assets/js/admin-settings.js', __FILE__), [], ZYON_CHECKOUT_VERSION, true);
        wp_localize_script('zyonagch-admin-settings', 'zyonagchAdmin', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('zyon_test_connection'),
        ]);

        echo '</div>';
    }

    public function handle_test_connection(): void {
        check_ajax_referer('zyon_test_connection');
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => 'Permissão negada'], 403);
        }

        $api_url = trim((string) get_option('zyon_api_url', ''));
        $api_key = (string) get_option('zyon_api_key', '');

        if ($api_url === '' || $api_key === '') {
            wp_send_json_error(['message' => 'Preencha a API Key e salve antes de testar.']);
        }

        $result = HttpClient::post(
            rtrim($api_url, '/') . '/embed-sessions',
            [
                'Content-Type' => 'application/json',
                'x-aacp-api-key' => $api_key,
                'Idempotency-Key' => 'test_' . wp_generate_uuid4(),
            ],
            ['ttl_seconds' => 60, 'allowed_origin' => 'http://localhost', 'scopes' => ['checkout:start']]
        );

        if ($result['error'] !== null) {
            wp_send_json_error(['message' => 'Falha: ' . $result['error']]);
        }

        if ($result['code'] >= 200 && $result['code'] < 300) {
            // Auto-detect merchant_id from token
            $body = json_decode((string) $result['body'], true);
            if (is_array($body) && !empty($body['embed_session_token'])) {
                $token_parts = explode('.', $body['embed_session_token']);
                if (count($token_parts) >= 2) {
                    $payload = json_decode(base64_decode(strtr($token_parts[0], '-_', '+/')), true);
                    if (!empty($payload['merchantId'])) {
                        update_option('zyon_merchant_id', sanitize_text_field($payload['merchantId']));
                    }
                }
                // Auto-detect webhook secret if provided
                if (!empty($body['widget_config']['webhook_secret'])) {
                    update_option('zyon_webhook_secret', preg_replace('/[^\x20-\x7E]/', '', $body['widget_config']['webhook_secret']));
                }
            }
            wp_send_json_success(['message' => '✓ Conectado com sucesso!']);
        }

        $body = json_decode((string) $result['body'], true);
        $detail = is_array($body) ? ($body['detail'] ?? $body['message'] ?? 'Erro') : 'HTTP ' . $result['code'];
        wp_send_json_error(['message' => 'Erro: ' . $detail]);
    }
}
