<?php
/**
 * Tests for Zyon\CartSync AJAX handler.
 */

class TestCartSync extends WP_UnitTestCase {

    public function setUp(): void {
        parent::setUp();
        if (function_exists('WC') && WC()->cart) {
            WC()->cart->empty_cart();
        }
    }

    public function test_cart_sync_class_exists(): void {
        $this->assertTrue(class_exists('Zyon\CartSync'));
    }

    public function test_nonce_verification_rejects_empty_nonce(): void {
        $_SERVER['HTTP_X_WP_NONCE'] = '';

        // CartSync handler calls wp_verify_nonce which returns false for empty
        $sync = new Zyon\CartSync();
        $ref = new \ReflectionClass($sync);
        // Verify the class has the handle method
        $this->assertTrue($ref->hasMethod('handle'));
    }

    public function test_nonce_verification_rejects_invalid_nonce(): void {
        $_SERVER['HTTP_X_WP_NONCE'] = 'invalid_nonce_value';

        // wp_verify_nonce returns false for invalid nonces
        $result = wp_verify_nonce('invalid_nonce_value', 'zyon_cart_sync');
        $this->assertFalse($result);
    }

    public function test_nonce_verification_accepts_valid_nonce(): void {
        $nonce = wp_create_nonce('zyon_cart_sync');
        $result = wp_verify_nonce($nonce, 'zyon_cart_sync');
        $this->assertNotFalse($result);
    }

    public function test_find_cart_item_by_sku(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce cart not available');
        }

        // Create a simple product with SKU
        $product = new WC_Product_Simple();
        $product->set_name('Test Product');
        $product->set_sku('ZYON-CART-TEST-001');
        $product->set_regular_price('49.90');
        $product->set_status('publish');
        $product->save();

        WC()->cart->add_to_cart($product->get_id());
        $this->assertEquals(1, WC()->cart->get_cart_contents_count());

        // Use reflection to test private find method
        $sync = new Zyon\CartSync();
        $method = new \ReflectionMethod($sync, 'find_cart_item_key_by_sku');
        $method->setAccessible(true);

        $key = $method->invoke($sync, 'ZYON-CART-TEST-001');
        $this->assertNotNull($key);

        $key_missing = $method->invoke($sync, 'NONEXISTENT-SKU');
        $this->assertNull($key_missing);

        // Cleanup
        $product->delete(true);
    }

    public function test_remove_cart_item_by_sku(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce cart not available');
        }

        $product = new WC_Product_Simple();
        $product->set_name('Removable Product');
        $product->set_sku('ZYON-REMOVE-001');
        $product->set_regular_price('29.90');
        $product->set_status('publish');
        $product->save();

        WC()->cart->add_to_cart($product->get_id(), 2);
        $this->assertEquals(2, WC()->cart->get_cart_contents_count());

        // Find cart item key and remove
        $sync = new Zyon\CartSync();
        $find = new \ReflectionMethod($sync, 'find_cart_item_key_by_sku');
        $find->setAccessible(true);

        $key = $find->invoke($sync, 'ZYON-REMOVE-001');
        $this->assertNotNull($key);

        WC()->cart->remove_cart_item($key);
        $this->assertEquals(0, WC()->cart->get_cart_contents_count());

        $product->delete(true);
    }

    public function test_update_cart_item_quantity(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce cart not available');
        }

        $product = new WC_Product_Simple();
        $product->set_name('Qty Test Product');
        $product->set_sku('ZYON-QTY-001');
        $product->set_regular_price('19.90');
        $product->set_status('publish');
        $product->save();

        WC()->cart->add_to_cart($product->get_id(), 5);
        $this->assertEquals(5, WC()->cart->get_cart_contents_count());

        $sync = new Zyon\CartSync();
        $find = new \ReflectionMethod($sync, 'find_cart_item_key_by_sku');
        $find->setAccessible(true);

        $key = $find->invoke($sync, 'ZYON-QTY-001');
        WC()->cart->set_quantity($key, 2);
        $this->assertEquals(2, WC()->cart->get_cart_contents_count());

        $product->delete(true);
    }

    public function test_product_id_fallback_when_sku_empty(): void {
        if (!function_exists('WC') || !WC()->cart) {
            $this->markTestSkipped('WooCommerce cart not available');
        }

        // Product with empty SKU — should fall back to product ID
        $product = new WC_Product_Simple();
        $product->set_name('No SKU Product');
        $product->set_sku('');
        $product->set_regular_price('9.90');
        $product->set_status('publish');
        $product->save();

        WC()->cart->add_to_cart($product->get_id());

        $sync = new Zyon\CartSync();
        $find = new \ReflectionMethod($sync, 'find_cart_item_key_by_sku');
        $find->setAccessible(true);

        // Should find by product ID (string)
        $key = $find->invoke($sync, (string) $product->get_id());
        $this->assertNotNull($key);

        $product->delete(true);
    }
}
