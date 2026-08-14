<?php
declare(strict_types=1);

namespace Zyon\Checkout\Block;

use Magento\Framework\View\Element\Template;
use Zyon\Checkout\Helper\Config;

class Widget extends Template
{
    private Config $config;

    public function __construct(
        Template\Context $context,
        Config $config,
        array $data = []
    ) {
        parent::__construct($context, $data);
        $this->config = $config;
    }

    public function isEnabled(): bool
    {
        return $this->config->isEnabled()
            && !empty($this->config->getMerchantId())
            && !empty($this->config->getApiKey());
    }

    public function getMerchantId(): string
    {
        return $this->config->getMerchantId();
    }

    public function getApiKey(): string
    {
        return $this->config->getApiKey();
    }

    public function getApiBaseUrl(): string
    {
        return $this->config->getApiBaseUrl();
    }

    public function getWidgetJsUrl(): string
    {
        return $this->config->getWidgetJsUrl();
    }
}
