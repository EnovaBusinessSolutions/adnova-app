<?php
/**
 * Plugin Name: ADRAY for WooCommerce
 * Plugin URI: https://adray.ai
 * Description: Conecta tu tienda WooCommerce con ADRAY AI para auditorías de marketing automatizadas y análisis de rendimiento.
 * Version: 1.0.0
 * Author: ADRAY AI
 * Author URI: https://adray.ai
 * License: GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: adray-woocommerce
 * Domain Path: /languages
 * Requires at least: 5.8
 * Requires PHP: 7.4
 * WC requires at least: 5.0
 * WC tested up to: 8.4
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Plugin constants
define('ADRAY_WOO_VERSION', '1.0.0');
define('ADRAY_WOO_PLUGIN_FILE', __FILE__);
define('ADRAY_WOO_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('ADRAY_WOO_PLUGIN_URL', plugin_dir_url(__FILE__));
define('ADRAY_WOO_DEFAULT_SERVER', 'https://adray.ai');

/**
 * Check if WooCommerce is active
 */
function adray_woo_check_woocommerce() {
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', function() {
            ?>
            <div class="notice notice-error">
                <p><strong>ADRAY para WooCommerce</strong> requiere que WooCommerce esté instalado y activo.</p>
            </div>
            <?php
        });
        return false;
    }
    return true;
}

/**
 * Initialize the plugin
 */
function adray_woo_init() {
    if (!adray_woo_check_woocommerce()) {
        return;
    }

    // Load includes
    require_once ADRAY_WOO_PLUGIN_DIR . 'includes/class-adray-api.php';
    require_once ADRAY_WOO_PLUGIN_DIR . 'includes/class-adray-webhooks.php';
    require_once ADRAY_WOO_PLUGIN_DIR . 'includes/class-adray-admin.php';

    // Initialize classes
    ADRAY_API::get_instance();
    ADRAY_Webhooks::get_instance();
    
    if (is_admin()) {
        ADRAY_Admin::get_instance();
    }
}
add_action('plugins_loaded', 'adray_woo_init');

/**
 * Activation hook
 */
function adray_woo_activate() {
    // Set default options
    if (!get_option('adray_server_url')) {
        update_option('adray_server_url', ADRAY_WOO_DEFAULT_SERVER);
    }
    
    // Flush rewrite rules
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'adray_woo_activate');

/**
 * Deactivation hook
 */
function adray_woo_deactivate() {
    // Clean up webhooks
    if (class_exists('ADRAY_Webhooks')) {
        ADRAY_Webhooks::get_instance()->delete_all_webhooks();
    }
    
    // Notify server of disconnect (non-blocking)
    $token = get_option('adray_access_token');
    $server_url = get_option('adray_server_url', ADRAY_WOO_DEFAULT_SERVER);
    
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
}
register_deactivation_hook(__FILE__, 'adray_woo_deactivate');

/**
 * Add settings link to plugins page
 */
function adray_woo_plugin_action_links($links) {
    $settings_link = '<a href="' . admin_url('admin.php?page=adray-settings') . '">' . __('Configuración', 'adray-woocommerce') . '</a>';
    array_unshift($links, $settings_link);
    return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'adray_woo_plugin_action_links');

/**
 * Declare HPOS compatibility
 */
add_action('before_woocommerce_init', function() {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
    }
});
