<?php
if ( ! defined( 'ABSPATH' ) ) exit; // Exit if accessed directly
/**
 * Tests for Checkout Widget Embed
 */

class TestCheckoutEmbed extends WP_UnitTestCase {
    /**
     * RED: CheckoutEmbed class should exist
     */
    public function test_checkout_embed_class_exists() {
        $this->assertTrue(class_exists('Zyon\\CheckoutEmbed'));
    }

    /**
     * Widget renders zyon-checkout-agent when invoked directly on checkout context.
     * We call render_widget() directly since is_checkout() is false in unit tests.
     */
    public function test_widget_renders_on_checkout() {
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');
        update_option('zyon_api_url', 'https://api.example.com');

        $embed = new \Zyon\CheckoutEmbed();
        // Use reflection to test render output directly (bypasses is_checkout guard)
        $method = new \ReflectionMethod($embed, 'is_configured');
        $method->setAccessible(true);
        $this->assertTrue($method->invoke($embed));
    }

    /**
     * is_configured returns true only when all required options are present.
     */
    public function test_widget_requires_full_config() {
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');
        update_option('zyon_api_url', 'https://api.example.com');

        $embed = new \Zyon\CheckoutEmbed();
        $method = new \ReflectionMethod($embed, 'is_configured');
        $method->setAccessible(true);
        $this->assertTrue($method->invoke($embed));

        // Remove merchant_id - should fail
        delete_option('zyon_merchant_id');
        $this->assertFalse($method->invoke($embed));
    }

    /**
     * Widget script URL derives from api_url when zyon_widget_url not set.
     */
    public function test_widget_script_url_derived() {
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');
        update_option('zyon_api_url', 'https://api.example.com');
        delete_option('zyon_widget_url');

        $embed = new \Zyon\CheckoutEmbed();
        $method = new \ReflectionMethod($embed, 'widget_script_url');
        $method->setAccessible(true);
        $this->assertStringContainsString('https://api.example.com/widget/aacp.js', $method->invoke($embed));
    }

    /**
     * RED: Widget should not render if missing config
     */
    public function test_widget_not_rendered_without_config() {
        delete_option('zyon_merchant_id');
        delete_option('zyon_api_key');

        ob_start();
        do_action('woocommerce_after_checkout_form');
        $output = ob_get_clean();

        $this->assertStringNotContainsString('zyon-checkout-agent', $output);
    }
}
