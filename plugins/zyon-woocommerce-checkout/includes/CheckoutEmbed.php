<?php
namespace Zyon;

/**
 * Replaces WooCommerce cart/checkout with Zyon Checkout Agent widget.
 */
class CheckoutEmbed {
    public function __construct() {
        add_action('wp_enqueue_scripts', [$this, 'enqueue_widget_script']);
        add_action('wp_enqueue_scripts', [$this, 'inject_styles']);
        add_action('wp_footer', [$this, 'render_widget']);
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

        wp_enqueue_style('zyon-checkout-widget-css', $this->widget_css_url(), [], ZYON_CHECKOUT_VERSION);
        wp_enqueue_script('zyon-checkout-widget', $this->widget_script_url(), [], ZYON_CHECKOUT_VERSION, true);
    }

    public function render_widget(): void {
        if (!$this->is_checkout_target() || !$this->is_configured()) {
            return;
        }

        $merchant_id = trim((string) get_option('zyon_merchant_id', ''));
        $api_key = (string) get_option('zyon_api_key', '');
        $api_url = $this->server_api_url();
        $browser_api_url = $this->browser_api_url();
        $token_service = new EmbedToken($api_url, $api_key, $merchant_id);
        $embed_token = $token_service->fetch();

        printf(
            '<div class="zyon-checkout-takeover"><zyon-checkout-agent merchant-id="%s" api-base-url="%s" embed-session-token="%s" presentation-mode="inline" cart-json="%s"></zyon-checkout-agent></div>',
            esc_attr($merchant_id),
            esc_attr($browser_api_url),
            esc_attr($embed_token ?? ''),
            esc_attr($this->cart_json())
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
        if (!current_user_can('manage_woocommerce')) {
            return;
        }
        echo '<div class="woocommerce-info zyon-checkout-admin-notice">';
        echo esc_html__('Zyon Checkout is not configured. Native WooCommerce checkout remains active.', 'zyon-checkout');
        echo '</div>';
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
        return $this->server_api_url() === '' ? '' : rtrim($this->server_api_url(), '/') . '/widget/aacp.js';
    }

    private function widget_css_url(): string {
        return rtrim($this->browser_api_url(), '/') . '/widget/widget.css';
    }

    private function valid_url(string $url): string {
        $url = trim($url);
        if ($url === '') {
            return '';
        }
        if (defined('ZYON_DEV_MODE') && ZYON_DEV_MODE) {
            return esc_url_raw($url);
        }
        return strpos($url, 'https://') === 0 ? esc_url_raw($url) : '';
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

    private function takeover_css(): string {
        return '.wp-block-woocommerce-checkout,.woocommerce-checkout,.wc-block-checkout,.wp-block-woocommerce-cart,.wc-block-cart,.woocommerce-cart-form,.cart-collaterals,form.checkout,#order_review,.woocommerce-form-coupon-toggle,.woocommerce-info,.entry-content>*:not(.zyon-checkout-takeover),.wp-block-post-content>*:not(.zyon-checkout-takeover){display:none!important}header.wp-block-template-part,footer.wp-block-template-part,.wp-block-template-part[data-type="footer"],.site-header,.site-footer{display:none!important}.zyon-checkout-takeover{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:999999!important;background:#08080c!important}.zyon-checkout-takeover zyon-checkout-agent{display:block!important;width:100%!important;height:100%!important}';
    }
}
