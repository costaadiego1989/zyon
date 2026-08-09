<?php
/**
 * PHPUnit Bootstrap for Zyon WooCommerce Checkout Tests
 */

// Load WordPress Test Suite
$_tests_dir = getenv('WP_TESTS_DIR');
if (!$_tests_dir) {
    $_tests_dir = rtrim(sys_get_temp_dir(), '/\\') . '/wordpress-tests-lib';
}

if (!file_exists($_tests_dir . '/includes/functions.php')) {
    echo "Could not find WordPress test suite. Set WP_TESTS_DIR env var.\n";
    exit(1);
}

// Load the WordPress test suite
require_once $_tests_dir . '/includes/functions.php';

// Bootstrap WordPress
tests_add_filter('muplugins_loaded', function () {
    // Load WooCommerce
    require_once WP_CONTENT_DIR . '/plugins/woocommerce/woocommerce.php';

    // Load our plugin
    require_once dirname(dirname(__FILE__)) . '/zyon-woocommerce-checkout.php';
});

// Install WordPress
require_once $_tests_dir . '/includes/bootstrap.php';
