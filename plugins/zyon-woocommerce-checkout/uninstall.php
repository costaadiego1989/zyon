<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
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
    'zyon_store_logo_url',
    'zyon_accent_color',
];

foreach ($options as $option) {
    delete_option($option);
}

// Clean transients.
delete_transient('zyon_circuit_state');

// Remove order meta created by the plugin.
global $wpdb;
$wpdb->query(
    "DELETE FROM {$wpdb->postmeta} WHERE meta_key IN ('_zyon_payment_synced', '_zyon_order_synced', '_zyon_session_id')"
);
