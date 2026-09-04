<?php
// Force HTTPS only for WC REST API calls
if (php_sapi_name() !== 'cli' && isset($_SERVER['REQUEST_URI']) && strpos($_SERVER['REQUEST_URI'], '/wp-json/wc/') !== false) {
    $_SERVER['HTTPS'] = 'on';
}

