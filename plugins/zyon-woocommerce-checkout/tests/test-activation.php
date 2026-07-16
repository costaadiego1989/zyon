<?php
/**
 * Tests for plugin activation
 */

class TestActivation extends WP_UnitTestCase {
    /**
     * RED: Plugin should activate without errors
     */
    public function test_plugin_activates() {
        // Plugin already loaded by WP test framework
        $this->assertTrue(function_exists('zyon_checkout_init'));
    }

    /**
     * RED: Plugin requires WooCommerce
     */
    public function test_plugin_requires_woocommerce() {
        $this->assertTrue(class_exists('WooCommerce') || class_exists('woocommerce'));
    }

    /**
     * RED: Plugin version constant defined
     */
    public function test_version_constant_defined() {
        $this->assertTrue(defined('ZYON_CHECKOUT_VERSION'));
        $this->assertEquals('0.1.0', ZYON_CHECKOUT_VERSION);
    }

    /**
     * RED: Plugin paths defined
     */
    public function test_plugin_paths_defined() {
        $this->assertTrue(defined('ZYON_CHECKOUT_DIR'));
        $this->assertTrue(defined('ZYON_CHECKOUT_URL'));
        $this->assertTrue(defined('ZYON_CHECKOUT_FILE'));
        $this->assertStringEndsWith('/', ZYON_CHECKOUT_DIR);
        $this->assertStringEndsWith('/', ZYON_CHECKOUT_URL);
    }
}
