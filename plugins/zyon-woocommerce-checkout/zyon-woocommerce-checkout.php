<?php
/**
 * Plugin Name: Zyon Agentic Checkout for WooCommerce
 * Plugin URI: https://github.com/zyon-ai/woocommerce-plugin
 * Description: Integrates Zyon AI Checkout Agent into WooCommerce stores
 * Version: 0.1.0
 * Author: Zyon AI
 * Author URI: https://zyon.com
 * License: GPL v3
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Requires Plugins: woocommerce
 * Requires PHP: 7.4
 * Requires at least: 6.0
 * Domain Path: /languages
 * Text Domain: zyon-checkout
 */

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

define('ZYON_CHECKOUT_VERSION', '0.1.0');
define('ZYON_CHECKOUT_FILE', __FILE__);
define('ZYON_CHECKOUT_DIR', plugin_dir_path(__FILE__));
define('ZYON_CHECKOUT_URL', plugin_dir_url(__FILE__));

// Autoloader for plugin classes
spl_autoload_register(function ($class) {
    if (strpos($class, 'Zyon\\') === 0) {
        $file = ZYON_CHECKOUT_DIR . 'includes/' . str_replace('\\', '/', substr($class, 5)) . '.php';
        if (file_exists($file)) {
            require_once $file;
        }
    }
});

/**
 * Plugin activation hook
 */
function zyon_checkout_activate() {
    if (!class_exists('WooCommerce')) {
        deactivate_plugins(plugin_basename(__FILE__));
        wp_die(
            'Zyon Checkout requires WooCommerce to be activated.',
            'Plugin Dependency Error',
            ['back_link' => true]
        );
    }
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'zyon_checkout_activate');

/**
 * Plugin deactivation hook
 */
function zyon_checkout_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'zyon_checkout_deactivate');

/**
 * Initialize plugin
 */
function zyon_checkout_init() {
    // Load settings
    if (class_exists('Zyon\\Settings')) {
        new Zyon\Settings();
    }

    // Load checkout embed
    if (class_exists('Zyon\\CheckoutEmbed')) {
        new Zyon\CheckoutEmbed();
    }

    // Load webhook handler
    if (class_exists('Zyon\\WebhookHandler')) {
        new Zyon\WebhookHandler();
    }

    // Load order sync
    if (class_exists('Zyon\\OrderSync')) {
        new Zyon\OrderSync();
    }
}
add_action('plugins_loaded', 'zyon_checkout_init', 99);
