/**
 * Zyon Cart Sync - Listens for cart update events from the Zyon widget
 * and syncs them back to WooCommerce via AJAX.
 */
(function () {
    'use strict';

    var config = window.zyonCartSync || {};
    if (!config.ajaxUrl || !config.nonce) {
        return;
    }

    document.addEventListener('zyon:cart:update', function (e) {
        var d = e.detail;
        if (d && d.items && d.items.length) {
            fetch(config.ajaxUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WP-Nonce': config.nonce
                },
                body: JSON.stringify({ action: 'zyon_cart_sync', items: d.items })
            });
        }
    });
})();
