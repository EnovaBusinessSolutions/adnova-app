<?php
/**
 * Uninstall ADRAY for WooCommerce
 * 
 * This file runs when the plugin is deleted from WordPress.
 * It cleans up all plugin data.
 */

// If uninstall not called from WordPress, exit
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

// Notify server of uninstall (non-blocking)
$token = get_option('adray_access_token');
$server_url = get_option('adray_server_url', 'https://adray.ai');

if ($token && $server_url) {
    wp_remote_request(
        rtrim($server_url, '/') . '/api/woocommerce/install',
        array(
            'method' => 'DELETE',
            'headers' => array(
                'Authorization' => 'Bearer ' . $token,
                'Content-Type' => 'application/json'
            ),
            'timeout' => 5,
            'blocking' => false
        )
    );
}

// Delete webhooks
$webhook_ids = get_option('adray_webhook_ids', array());
if (!empty($webhook_ids) && function_exists('wc_get_webhook')) {
    foreach ($webhook_ids as $id) {
        try {
            $webhook = wc_get_webhook($id);
            if ($webhook) {
                $webhook->delete(true);
            }
        } catch (Exception $e) {
            // Continue with cleanup
        }
    }
}

// Delete all plugin options
$options = array(
    'adray_server_url',
    'adray_access_token',
    'adray_connected',
    'adray_connected_at',
    'adray_webhook_ids'
);

foreach ($options as $option) {
    delete_option($option);
}

// Clear any transients
delete_transient('adray_health_status');
