<?php
/**
 * Uninstall cleanup for Zyon Agentic Checkout for WooCommerce.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

$options = [
    'zyon_merchant_id',
    'zyon_api_key',
    'zyon_api_url',
    'zyon_webhook_secret',
    'zyon_widget_url',
    'zyon_browser_api_url',
];

foreach ($options as $option) {
    delete_option($option);
}
