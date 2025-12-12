/**
 * ADRAY WooCommerce Admin JavaScript
 */

(function ($) {
    'use strict';

    // Wait for DOM ready
    $(function () {
        var $message = $('#adray-message');
        var $serverUrl = $('#adray_server_url');
        var $healthCheck = $('#adray-health-check');
        var $connect = $('#adray-connect');
        var $disconnect = $('#adray-disconnect');

        /**
         * Show message
         */
        function showMessage(text, type) {
            $message
                .removeClass('success error info')
                .addClass(type)
                .text(text)
                .slideDown(200);
        }

        /**
         * Hide message
         */
        function hideMessage() {
            $message.slideUp(200);
        }

        /**
         * Set loading state
         */
        function setLoading($button, loading, text) {
            if (loading) {
                $button
                    .addClass('adray-loading')
                    .data('original-text', $button.html())
                    .html('<span class="adray-spinner"></span> ' + text);
            } else {
                $button
                    .removeClass('adray-loading')
                    .html($button.data('original-text'));
            }
        }

        /**
         * Health Check
         */
        $healthCheck.on('click', function (e) {
            e.preventDefault();

            var $btn = $(this);
            hideMessage();
            setLoading($btn, true, adrayAdmin.strings.checking);

            $.ajax({
                url: adrayAdmin.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'adray_health_check',
                    nonce: adrayAdmin.nonce,
                    server_url: $serverUrl.val()
                },
                success: function (response) {
                    if (response.success) {
                        showMessage('✓ ' + response.data.message, 'success');
                    } else {
                        showMessage('✗ ' + (response.data.message || 'Error'), 'error');
                    }
                },
                error: function () {
                    showMessage('✗ Error de conexión', 'error');
                },
                complete: function () {
                    setLoading($btn, false);
                }
            });
        });

        /**
         * Connect
         */
        $connect.on('click', function (e) {
            e.preventDefault();

            var $btn = $(this);
            hideMessage();
            setLoading($btn, true, adrayAdmin.strings.connecting);

            $.ajax({
                url: adrayAdmin.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'adray_connect',
                    nonce: adrayAdmin.nonce,
                    server_url: $serverUrl.val(),
                    connection_code: $('#adray_connection_code').val()
                },
                success: function (response) {
                    if (response.success) {
                        showMessage('✓ ' + response.data.message, 'success');
                        // Reload page to show connected state
                        setTimeout(function () {
                            location.reload();
                        }, 1000);
                    } else {
                        showMessage('✗ ' + (response.data.message || 'Error al conectar'), 'error');
                        setLoading($btn, false);
                    }
                },
                error: function () {
                    showMessage('✗ Error de conexión', 'error');
                    setLoading($btn, false);
                }
            });
        });

        /**
         * Disconnect
         */
        $disconnect.on('click', function (e) {
            e.preventDefault();

            if (!confirm('¿Estás seguro de que deseas desconectar tu tienda de ADRAY?')) {
                return;
            }

            var $btn = $(this);
            hideMessage();
            setLoading($btn, true, adrayAdmin.strings.disconnecting);

            $.ajax({
                url: adrayAdmin.ajaxUrl,
                type: 'POST',
                data: {
                    action: 'adray_disconnect',
                    nonce: adrayAdmin.nonce
                },
                success: function (response) {
                    if (response.success) {
                        showMessage('✓ ' + response.data.message, 'success');
                        // Reload page to show disconnected state
                        setTimeout(function () {
                            location.reload();
                        }, 1000);
                    } else {
                        showMessage('✗ ' + (response.data.message || 'Error'), 'error');
                        setLoading($btn, false);
                    }
                },
                error: function () {
                    showMessage('✗ Error de conexión', 'error');
                    setLoading($btn, false);
                }
            });
        });

        // Auto-hide messages after 10 seconds
        $(document).on('DOMSubtreeModified', '#adray-message', function () {
            if ($message.is(':visible')) {
                setTimeout(function () {
                    $message.slideUp(200);
                }, 10000);
            }
        });
    });

})(jQuery);
