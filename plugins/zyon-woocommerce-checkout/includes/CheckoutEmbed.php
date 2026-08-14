<?php
namespace Zyon;
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly

/**
 * Replaces WooCommerce cart/checkout with Zyon Checkout Agent widget.
 */
class CheckoutEmbed {
    public function __construct() {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_widget_script']);
        add_action('wp_enqueue_scripts', [$this, 'inject_styles']);
        add_action('template_redirect', [$this, 'render_takeover_page'], 1);
        add_filter('the_content', [$this, 'replace_checkout_content'], 99);
    }

    public function inject_styles(): void {
        if (!$this->is_checkout_target() || !$this->is_configured()) {
            return;
        }

        wp_add_inline_style('wp-block-library', $this->takeover_css());
    }

    public function enqueue_widget_script(): void {
        if (!$this->is_checkout_target()) {
            return;
        }
        if (!$this->is_configured()) {
            $this->render_admin_notice();
            return;
        }

        $cache_bust = defined('ZYON_DEV_MODE') && ZYON_DEV_MODE ? (string) time() : ZYON_CHECKOUT_VERSION;
        wp_enqueue_style('zyon-checkout-widget-css', $this->widget_css_url(), [], $cache_bust);
        wp_enqueue_script('zyon-checkout-widget', $this->widget_script_url(), [], $cache_bust, true);
    }

    public function render_takeover_page(): void {
        if (!$this->is_checkout_target()) {
            return;
        }

        if (!$this->is_configured()) {
            // Not configured — let WooCommerce render native checkout
            return;
        }

        $markup = $this->widget_markup();
        if ($markup === null) {
            // Token fetch failed (API down) — graceful fallback to native checkout
            return;
        }

        status_header(200);
        nocache_headers();
        echo '<!doctype html><html ' . get_language_attributes() . '><head><meta charset="' . esc_attr(get_bloginfo('charset')) . '"><meta name="viewport" content="width=device-width,initial-scale=1">';
        wp_head();
        echo '</head><body class="zyon-checkout-body">';
        echo $markup;
        wp_footer();
        echo '</body></html>';
        exit;
    }

    public function replace_checkout_content(string $content): string {
        if (!$this->is_checkout_target()) {
            return $content;
        }

        if (!$this->is_configured()) {
            return $content . $this->admin_notice_markup();
        }

        $markup = $this->widget_markup();
        return $markup ?? $content; // Fallback to native checkout if token unavailable
    }

    private function widget_markup(): ?string {
        $merchant_id = trim((string) get_option('zyon_merchant_id', ''));
        $api_key = (string) get_option('zyon_api_key', '');
        $api_url = $this->server_api_url();
        $browser_api_url = $this->browser_api_url();
        $token_service = new EmbedToken($api_url, $api_key, $merchant_id);
        $embed_token = $token_service->fetch() ?? $this->dev_embed_token($merchant_id);

        // If no token available (API down + not in dev mode), signal fallback
        if (!$embed_token) {
            $this->log_fallback('Embed token unavailable — falling back to native WooCommerce checkout.');
            return null;
        }

        // Get widget config from API (brand, agent identity)
        $widget_config = $token_service->widget_config();
        $brand = $widget_config['brand'] ?? null;
        $agent = $widget_config['agent'] ?? null;

        // Build brand-json from API config, with WP fallbacks
        $brand_json = wp_json_encode(array_filter([
            'name' => $brand['name'] ?? get_bloginfo('name') ?: 'Loja',
            'logoUrl' => $brand['logoUrl'] ?? $this->store_logo_url(),
            'accentColor' => $brand['accentColor'] ?? $this->accent_color(),
            'backgroundColor' => $brand['backgroundColor'] ?? null,
            'textColor' => $brand['textColor'] ?? null,
            'fontFamily' => $brand['fontFamily'] ?? null,
            'borderRadius' => $brand['borderRadius'] ?? null,
        ], fn($v) => $v !== null));

        // Build agent-json from API config
        $agent_json = $agent ? wp_json_encode(array_filter([
            'name' => $agent['name'] ?? null,
            'greeting' => $agent['greeting'] ?? null,
            'tone' => $agent['tone'] ?? null,
        ], fn($v) => $v !== null)) : '';

        $ajax_url = admin_url('admin-ajax.php');
        $cart_nonce = wp_create_nonce('zyon_cart_sync');

        $attrs = sprintf(
            'merchant-id="%s" api-base-url="%s" embed-session-token="%s" cart-json="%s" store-url="%s" brand-json="%s"',
            esc_attr($merchant_id),
            esc_attr($browser_api_url),
            esc_attr($embed_token ?? ''),
            esc_attr($this->cart_json()),
            esc_attr(home_url('/')),
            esc_attr($brand_json)
        );

        if ($agent_json !== '') {
            $attrs .= sprintf(' agent-json="%s"', esc_attr($agent_json));
        }

        wp_enqueue_script('zyonagch-cart-sync', plugins_url('../assets/js/cart-sync.js', __FILE__), [], '1.0.0', true);
        wp_localize_script('zyonagch-cart-sync', 'zyonCartSync', [
            'ajaxUrl' => esc_url($ajax_url . '?action=zyon_cart_sync'),
            'nonce' => $cart_nonce,
        ]);

        return sprintf(
            '<div class="zyon-checkout-takeover"><zyon-checkout-agent %s></zyon-checkout-agent></div>',
            $attrs
        );
    }

    private function is_checkout_target(): bool {
        if (!function_exists('is_cart') || !function_exists('is_checkout')) {
            return false;
        }
        return (is_cart() || is_checkout()) && !is_wc_endpoint_url('order-received');
    }

    private function is_configured(): bool {
        return $this->server_api_url() !== ''
            && $this->widget_script_url() !== ''
            && trim((string) get_option('zyon_merchant_id', '')) !== ''
            && (string) get_option('zyon_api_key', '') !== '';
    }

    private function render_admin_notice(): void {
        echo $this->admin_notice_markup();
    }

    private function admin_notice_markup(): string {
        if (!current_user_can('manage_woocommerce')) {
            return '';
        }
        return '<div class="woocommerce-info zyon-checkout-admin-notice">'
            . esc_html__('Zyon Checkout is not configured. Native WooCommerce checkout remains active.', 'zyon-agentic-checkout-for-woocommerce')
            . '</div>';
    }

    private function server_api_url(): string {
        return $this->valid_url((string) get_option('zyon_api_url', ''));
    }

    private function browser_api_url(): string {
        $browser_url = (string) get_option('zyon_browser_api_url', '');
        return $this->valid_url($browser_url) ?: $this->server_api_url();
    }

    private function widget_script_url(): string {
        $widget_url = (string) get_option('zyon_widget_url', '');
        if ($this->valid_url($widget_url) !== '') {
            return $this->valid_url($widget_url);
        }
        return $this->browser_api_url() === '' ? '' : rtrim($this->browser_api_url(), '/') . '/widget/aacp.js';
    }

    private function widget_css_url(): string {
        return rtrim($this->browser_api_url(), '/') . '/widget/widget.css';
    }

    private function store_logo_url(): string {
        $configured = $this->valid_url((string) get_option('zyon_store_logo_url', ''));
        if ($configured !== '') {
            return $configured;
        }
        $custom_logo_id = (int) get_theme_mod('custom_logo');
        if ($custom_logo_id > 0) {
            $logo = wp_get_attachment_image_url($custom_logo_id, 'full');
            return $logo ? $this->valid_url((string) $logo) : '';
        }
        return '';
    }

    private function accent_color(): string {
        $configured = sanitize_hex_color((string) get_option('zyon_accent_color', ''));
        if ($configured) {
            return $configured;
        }
        $theme_color = sanitize_hex_color((string) get_theme_mod('accent_color', ''));
        return $theme_color ?: '#0f766e';
    }

    private function valid_url(string $url): string {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        if (strpos($url, 'https://') === 0) {
            return esc_url_raw($url);
        }
        if ((defined('ZYON_DEV_MODE') && ZYON_DEV_MODE) || $this->is_local_dev_url($url)) {
            return esc_url_raw($url);
        }
        return '';
    }

    private function is_local_dev_url(string $url): bool {
        $host = parse_url($url, PHP_URL_HOST);
        return in_array($host, ['localhost', '127.0.0.1', 'host.docker.internal'], true);
    }

    private function dev_embed_token(string $merchant_id): ?string {
        if (!$this->is_local_dev_url($this->browser_api_url())) {
            return null;
        }
        $now = time();
        $claims = [
            'typ' => 'aacp_embed_v1',
            'merchantId' => $merchant_id,
            'issuedAtUnix' => $now,
            'expiresAtUnix' => $now + 900,
            'nonce' => wp_generate_uuid4(),
            'allowedOrigin' => home_url(),
            'scopes' => ['checkout:start', 'checkout:track', 'checkout:chat', 'offers:apply', 'payment:intents:create'],
        ];
        $payload = $this->base64url_encode(wp_json_encode($claims));
        $signature = hash_hmac('sha256', $payload, 'dev_embed_token_secret_32_characters_min!!', true);
        return $payload . '.' . $this->base64url_encode($signature);
    }

    private function base64url_encode(string $value): string {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function cart_json(): string {
        if (!function_exists('WC') || !WC()->cart) {
            return '';
        }
        $cart = $this->cart_payload();
        return empty($cart['items']) ? '' : (string) wp_json_encode($cart);
    }

    private function cart_payload(): array {
        $items = [];
        $total = 0.0;
        foreach (WC()->cart->get_cart() as $item) {
            $product = $item['data'];
            $quantity = (int) $item['quantity'];
            $price = (float) $product->get_price();
            $items[] = $this->cart_item($product, $quantity, $price);
            $total += $price * $quantity;
        }
        return ['currency' => get_woocommerce_currency(), 'total' => $total, 'items' => $items, 'source' => 'storefront'];
    }

    private function cart_item($product, int $quantity, float $price): array {
        return [
            'sku' => $product->get_sku() ?: (string) $product->get_id(),
            'name' => $product->get_name(),
            'price' => $price,
            'quantity' => $quantity,
        ];
    }

    private function log_fallback(string $message): void {
        if (function_exists('wc_get_logger')) {
            wc_get_logger()->warning('[Zyon] ' . $message, ['source' => 'zyon-checkout']);
            return;
        }
        error_log('[Zyon] ' . $message);
    }

    private function takeover_css(): string {
        return 'html:has(.zyon-checkout-takeover),body.zyon-checkout-body{margin:0!important;width:100%!important;height:100%!important;min-height:100%!important;overflow:hidden!important}.woocommerce-cart .wp-site-blocks,.woocommerce-checkout .wp-site-blocks{margin:0!important;padding:0!important}.woocommerce-cart header.wp-block-template-part,.woocommerce-checkout header.wp-block-template-part,.woocommerce-cart footer.wp-block-template-part,.woocommerce-checkout footer.wp-block-template-part,.woocommerce-cart .wp-block-template-part[data-type="footer"],.woocommerce-checkout .wp-block-template-part[data-type="footer"],.woocommerce-cart .site-header,.woocommerce-checkout .site-header,.woocommerce-cart .site-footer,.woocommerce-checkout .site-footer{display:none!important}.zyon-checkout-takeover{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;height:100dvh!important;z-index:999999!important;background:var(--aacp-bg,#08080c)!important;overflow:hidden!important;display:flex!important;align-items:center!important;justify-content:center!important;transition:background .3s ease!important}.zyon-checkout-takeover zyon-checkout-agent,.zyon-checkout-takeover zyon-checkout-agent>div{display:flex!important;width:100%!important;height:100%!important;align-items:center!important;justify-content:center!important}.zyon-checkout-takeover .app-shell{width:100%!important;max-width:760px!important;height:100%!important;max-height:100%!important;padding:0!important;align-items:center!important;overflow:hidden!important}.zyon-checkout-takeover .pulse-widget-shell{max-width:760px!important;width:100%!important;height:100%!important}.zyon-checkout-takeover .pulse-widget-frame{width:100%!important;height:100%!important;max-height:none!important;margin:0!important;filter:none!important;max-width:760px!important}.zyon-checkout-takeover .pulse-widget-inner{height:100%!important;min-height:0!important}.zyon-checkout-takeover .shimmer-border::before{display:none!important}';
    }
}
