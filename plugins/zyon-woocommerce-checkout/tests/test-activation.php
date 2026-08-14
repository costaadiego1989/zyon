<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
/**
 * Tests for plugin activation.
 */

class TestActivation extends WP_UnitTestCase {
    public function test_plugin_activates() {
        $this->assertTrue(function_exists('zyon_checkout_init'));
    }

    public function test_plugin_requires_woocommerce() {
        $this->assertTrue(class_exists('WooCommerce') || class_exists('woocommerce'));
    }

    public function test_version_constant_defined() {
        $this->assertTrue(defined('ZYON_CHECKOUT_VERSION'));
        $this->assertEquals('1.0.0', ZYON_CHECKOUT_VERSION);
    }

    public function test_plugin_paths_defined() {
        $this->assertTrue(defined('ZYON_CHECKOUT_DIR'));
        $this->assertTrue(defined('ZYON_CHECKOUT_URL'));
        $this->assertTrue(defined('ZYON_CHECKOUT_FILE'));
        $this->assertStringEndsWith('/', ZYON_CHECKOUT_DIR);
        $this->assertStringEndsWith('/', ZYON_CHECKOUT_URL);
    }
}
