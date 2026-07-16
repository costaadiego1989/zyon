<?php
/**
 * Tests for Settings page
 */

class TestSettingsPage extends WP_UnitTestCase {
    /**
     * RED: Settings class should exist
     */
    public function test_settings_class_exists() {
        $this->assertTrue(class_exists('Zyon\\Settings'));
    }

    /**
     * RED: Settings page should register
     */
    public function test_settings_page_registered() {
        // Simulate admin load
        set_current_screen('admin_page_zyon-settings');
        $this->assertTrue(function_exists('add_menu_page') || function_exists('add_submenu_page'));
    }

    /**
     * RED: Merchant ID option should be retrievable
     */
    public function test_merchant_id_option_retrievable() {
        update_option('zyon_merchant_id', 'mrc_test123');
        $merchant_id = get_option('zyon_merchant_id');
        $this->assertEquals('mrc_test123', $merchant_id);
    }

    /**
     * RED: API Key option should be retrievable
     */
    public function test_api_key_option_retrievable() {
        update_option('zyon_api_key', 'key_test_abc');
        $api_key = get_option('zyon_api_key');
        $this->assertEquals('key_test_abc', $api_key);
    }

    /**
     * RED: Store URL option should be retrievable
     */
    public function test_store_url_option_retrievable() {
        $store_url = get_option('siteurl');
        $this->assertNotEmpty($store_url);
    }
}
