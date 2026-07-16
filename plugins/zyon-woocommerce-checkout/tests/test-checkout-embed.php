<?php
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
     * RED: Widget should render on checkout page
     */
    public function test_widget_renders_on_checkout() {
        // Set required options
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');
        update_option('zyon_store_url', home_url());

        // Capture output from checkout hook
        ob_start();
        do_action('woocommerce_after_checkout_form');
        $output = ob_get_clean();

        // Should contain zyon-checkout-agent tag
        $this->assertStringContainsString('zyon-checkout-agent', $output);
    }

    /**
     * RED: Widget should have valid embed token attribute
     */
    public function test_widget_has_embed_token() {
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');
        update_option('zyon_store_url', home_url());

        ob_start();
        do_action('woocommerce_after_checkout_form');
        $output = ob_get_clean();

        // Should contain embed-session-token attribute
        $this->assertStringContainsString('embed-session-token', $output);
    }

    /**
     * RED: Widget should have merchant-id attribute
     */
    public function test_widget_has_merchant_id() {
        update_option('zyon_merchant_id', 'mrc_test');
        update_option('zyon_api_key', 'key_test');
        update_option('zyon_store_url', home_url());

        ob_start();
        do_action('woocommerce_after_checkout_form');
        $output = ob_get_clean();

        // Should contain data-merchant-id
        $this->assertStringContainsString('data-merchant-id', $output);
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
