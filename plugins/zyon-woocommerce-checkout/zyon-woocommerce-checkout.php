<?php
/**
 * Plugin Name: Zyon Agentic Checkout for WooCommerce
 * Plugin URI: https://wordpress.org/plugins/zyon-agentic-checkout/
 * Description: Integrates Zyon AI Checkout Agent into WooCommerce stores
 * Version: 1.0.0
 * Author: Zyon AI
 * Author URI: https://zyon.com
 * License: GPL v3
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * Domain Path: /languages
 * Text Domain: zyon-agentic-checkout-for-woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ZYON_CHECKOUT_VERSION', '1.0.0');
define('ZYON_CHECKOUT_FILE', __FILE__);
define('ZYON_CHECKOUT_DIR', plugin_dir_path(__FILE__));
define('ZYON_CHECKOUT_URL', plugin_dir_url(__FILE__));

spl_autoload_register(function ($class) {
    if (strpos($class, 'Zyon\\') !== 0) {
        return;
    }
    $file = ZYON_CHECKOUT_DIR . 'includes/' . str_replace('\\', '/', substr($class, 5)) . '.php';
    if (file_exists($file)) {
        require_once $file;
    }
});

function zyon_checkout_activate(): void {
    if (!class_exists('WooCommerce')) {
        deactivate_plugins(plugin_basename(__FILE__));
        wp_die('Zyon Checkout requires WooCommerce to be activated.', 'Plugin Dependency Error', ['back_link' => true]);
    }
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'zyon_checkout_activate');

function zyon_checkout_deactivate(): void {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'zyon_checkout_deactivate');

function zyon_checkout_init(): void {
    new Zyon\Settings();
    new Zyon\CheckoutEmbed();
    new Zyon\WebhookHandler();
    new Zyon\OrderSync();
    new Zyon\CartSync();
}
add_action('plugins_loaded', 'zyon_checkout_init', 99);
