# Zyon Checkout Module for Magento 2

## Overview

Zyon Checkout is an AI-powered negotiation and checkout widget for Magento 2. This module integrates the Zyon Checkout Agent directly into your Magento storefront, enabling merchants to engage buyers with intelligent cross-sell offers, dynamic pricing, and frictionless checkout.

## Features

- **AI-Powered Checkout Widget**: Displays on product and cart pages
- **Admin Configuration Panel**: Easy setup via Stores → Configuration
- **Secure API Integration**: Encrypted API key storage
- **Per-Store Configuration**: Multi-store support with store-scoped settings
- **Deterministic Fallbacks**: Works without API credentials during setup

## Requirements

- **Magento 2.4.0+**
- **PHP 8.1 or higher**
- **Composer** (dependency manager)
- Valid Zyon Merchant ID and API Key (obtain from [Zyon Dashboard](https://dashboard.zyon.com.br))

## Installation

### Step 1: Add the Module via Composer

```bash
composer require zyon/checkout-module
```

### Step 2: Enable the Module

```bash
bin/magento setup:upgrade
bin/magento cache:flush
```

### Step 3: Deploy Static Files (Production)

```bash
bin/magento setup:static-content:deploy
```

## Configuration

1. Go to **Magento Admin Panel** → **Stores** → **Configuration**
2. Expand the **Zyon** tab (left sidebar)
3. Click **Checkout Widget**
4. Configure the following sections:

### General Settings

- **Enable Zyon Checkout**: Toggle to enable/disable the module
- **Merchant ID**: Your unique Zyon merchant identifier
- **API Key**: Your Zyon API authentication key (auto-encrypted)
- **API Base URL**: Default is `https://api.zyon.com.br/v1` — change only for custom environments
- **Widget JS URL**: Default is `https://cdn.zyon.com.br/widget/aacp.js` — change only for custom CDN

### Display Settings

- **Show on Product Pages**: Enable to display the widget on individual product pages
- **Show on Cart Page**: Enable to display the widget on the shopping cart page

## How It Works

1. **Widget Injection**: Once configured, the Zyon widget script and custom element are injected into frontend pages
2. **Initialization**: The widget initializes with your Merchant ID, API Key, and API endpoint
3. **Session Handling**: The Zyon API manages all checkout sessions, negotiations, and payments
4. **Order Creation**: Completed orders are transmitted to Magento via REST API

## Uninstallation

```bash
bin/magento module:disable Zyon_Checkout
composer remove zyon/checkout-module
bin/magento setup:upgrade
bin/magento cache:flush
```

## Troubleshooting

### Widget Not Appearing

- Verify the module is enabled: `bin/magento module:status | grep Zyon`
- Check that **Enable Zyon Checkout** is set to **Yes** in admin config
- Confirm **Merchant ID** and **API Key** are populated and valid
- Clear Magento cache: `bin/magento cache:flush`

### API Key Not Saving

- Ensure you have write permissions in `var/` directory
- Verify encryption key exists at `app/etc/env.php`
- Re-save the configuration after granting permissions

### Widget Initialization Errors

- Open browser console and check for JavaScript errors
- Verify the **Widget JS URL** is accessible and not blocked by CORS
- Ensure your Merchant ID matches the one in your Zyon Dashboard

## Support

For issues or questions:
- Contact [Zyon Support](https://support.zyon.com.br)
- Check the [Zyon Documentation](https://docs.zyon.com.br)

## License

Proprietary — All rights reserved by Zyon.
