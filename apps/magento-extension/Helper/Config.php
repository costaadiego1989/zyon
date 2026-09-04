<?php
declare(strict_types=1);

namespace Zyon\Checkout\Helper;

use Magento\Framework\App\Helper\AbstractHelper;
use Magento\Store\Model\ScopeInterface;

class Config extends AbstractHelper
{
    private const XML_PATH_ENABLED = 'zyon_checkout/general/enabled';
    private const XML_PATH_MERCHANT_ID = 'zyon_checkout/general/merchant_id';
    private const XML_PATH_API_KEY = 'zyon_checkout/general/api_key';
    private const XML_PATH_API_BASE_URL = 'zyon_checkout/general/api_base_url';
    private const XML_PATH_WIDGET_JS_URL = 'zyon_checkout/general/widget_js_url';
    private const XML_PATH_SHOW_ON_PRODUCT = 'zyon_checkout/display/show_on_product';
    private const XML_PATH_SHOW_ON_CART = 'zyon_checkout/display/show_on_cart';

    public function isEnabled(?int $storeId = null): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_PATH_ENABLED, ScopeInterface::SCOPE_STORE, $storeId);
    }

    public function getMerchantId(?int $storeId = null): string
    {
        return (string) $this->scopeConfig->getValue(self::XML_PATH_MERCHANT_ID, ScopeInterface::SCOPE_STORE, $storeId);
    }

    public function getApiKey(?int $storeId = null): string
    {
        return (string) $this->scopeConfig->getValue(self::XML_PATH_API_KEY, ScopeInterface::SCOPE_STORE, $storeId);
    }

    public function getApiBaseUrl(?int $storeId = null): string
    {
        return (string) $this->scopeConfig->getValue(self::XML_PATH_API_BASE_URL, ScopeInterface::SCOPE_STORE, $storeId);
    }

    public function getWidgetJsUrl(?int $storeId = null): string
    {
        return (string) $this->scopeConfig->getValue(self::XML_PATH_WIDGET_JS_URL, ScopeInterface::SCOPE_STORE, $storeId);
    }

    public function showOnProduct(?int $storeId = null): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_PATH_SHOW_ON_PRODUCT, ScopeInterface::SCOPE_STORE, $storeId);
    }

    public function showOnCart(?int $storeId = null): bool
    {
        return $this->scopeConfig->isSetFlag(self::XML_PATH_SHOW_ON_CART, ScopeInterface::SCOPE_STORE, $storeId);
    }
}
