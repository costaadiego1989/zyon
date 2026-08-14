/**
 * Zyon Admin Settings - Test Connection button handler.
 */
(function () {
    'use strict';

    var config = window.zyonagchAdmin || {};
    var btn = document.getElementById('zyon-test-conn');
    var res = document.getElementById('zyon-test-result');

    if (!btn || !res || !config.ajaxUrl || !config.nonce) {
        return;
    }

    btn.addEventListener('click', function () {
        btn.disabled = true;
        res.textContent = 'Testing...';
        fetch(config.ajaxUrl + '?action=zyon_test_connection&_wpnonce=' + config.nonce, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.success) {
                    res.textContent = '✅ ' + d.data.message;
                } else {
                    res.textContent = '❌ ' + d.data.message;
                }
                btn.disabled = false;
            })
            .catch(function (e) {
                res.textContent = '❌ ' + e.message;
                btn.disabled = false;
            });
    });
})();
