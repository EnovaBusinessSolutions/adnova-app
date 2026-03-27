<?php
/**
 * Plugin Name: Adnova Pixel
 * Plugin URI: https://adnova.ai
 * Description: Instala automaticamente el pixel de Adnova en tu sitio WordPress y usa el dominio como Site ID.
 * Version: 1.1.8
 * Author: Adnova
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: adnova-pixel
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Adnova_Pixel_Plugin {
    const VERSION = '1.1.8';
    const OPTION_SCRIPT_URL = 'adnova_pixel_script_url';
    const OPTION_SITE_ID = 'adnova_pixel_site_id';
    const OPTION_BACKFILL_DONE = 'adnova_pixel_backfill_done';
    const DEFAULT_SCRIPT_URL = 'https://adray-app-staging-german.onrender.com/adray-pixel.js';
    const DEFAULT_COLLECT_URL = 'https://adray-app-staging-german.onrender.com/collect';
    const DEFAULT_ORDER_SYNC_URL = 'https://adray-app-staging-german.onrender.com/api/woo/orders-sync';
    const DEFAULT_UPDATE_METADATA_URL = 'https://adray-app-staging-german.onrender.com/wp-plugin/adnova-pixel/update.json';
    private static $processed_orders = array();

    public static function init() {
        register_activation_hook(__FILE__, array(__CLASS__, 'on_activate'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'enqueue_pixel_script'), 100);
        add_action('wp_footer', array(__CLASS__, 'ensure_pixel_fallback_tag'), 999);
        add_filter('script_loader_tag', array(__CLASS__, 'inject_script_attributes'), 10, 3);
        add_filter('pre_set_site_transient_update_plugins', array(__CLASS__, 'inject_plugin_update'));
        add_filter('plugins_api', array(__CLASS__, 'plugins_api_handler'), 10, 3);
        add_filter('auto_update_plugin', array(__CLASS__, 'enable_auto_update'), 10, 2);
        // WooCommerce: fire purchase on thank-you page
        add_action('woocommerce_thankyou', array(__CLASS__, 'on_woo_order_received'), 10, 1);
        // Server-side order capture even when thank-you is not rendered in browser.
        add_action('woocommerce_payment_complete', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_processing', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_completed', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_refunded', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_refunded', array(__CLASS__, 'on_woo_order_refunded'), 10, 2);
        add_action('woocommerce_checkout_update_order_meta', array(__CLASS__, 'save_pixel_cookies_to_order'), 10, 1);
        add_action('wp_login', array(__CLASS__, 'track_wp_login_event'), 10, 2);
        add_action('wp_logout', array(__CLASS__, 'track_wp_logout_event'));
        add_action('wp_footer', array(__CLASS__, 'inject_logged_in_customer_context'), 20);
        // Fallback for custom checkout flows/themes where woocommerce_thankyou is bypassed.
        add_action('wp_footer', array(__CLASS__, 'maybe_track_woo_order_received_fallback'), 1000);
        add_action('adnova_pixel_backfill_orders', array(__CLASS__, 'backfill_recent_orders'));
        self::maybe_schedule_backfill();
    }

    public static function on_activate() {
        if (!get_option(self::OPTION_SCRIPT_URL)) {
            update_option(self::OPTION_SCRIPT_URL, self::DEFAULT_SCRIPT_URL, false);
        }

        if (!get_option(self::OPTION_SITE_ID)) {
            update_option(self::OPTION_SITE_ID, self::detect_site_id(), false);
        }

        self::send_activation_ping();

        if (!wp_next_scheduled('adnova_pixel_backfill_orders')) {
            wp_schedule_single_event(time() + 30, 'adnova_pixel_backfill_orders');
        }

        delete_site_transient('update_plugins');
    }

    private static function maybe_schedule_backfill() {
        if (!function_exists('wc_get_orders')) {
            return;
        }

        $done_version = get_option(self::OPTION_BACKFILL_DONE, '');
        if ($done_version === self::VERSION) {
            return;
        }

        if (!wp_next_scheduled('adnova_pixel_backfill_orders')) {
            wp_schedule_single_event(time() + 30, 'adnova_pixel_backfill_orders');
        }
    }

    private static function get_plugin_basename() {
        return plugin_basename(__FILE__);
    }

    private static function fetch_update_metadata() {
        $url = self::DEFAULT_UPDATE_METADATA_URL . '?t=' . time();
        $response = wp_remote_get($url, array(
            'timeout' => 10,
            'headers' => array('Accept' => 'application/json'),
        ));

        if (is_wp_error($response)) {
            return null;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            return null;
        }

        $body = wp_remote_retrieve_body($response);
        $decoded = json_decode($body, true);

        return is_array($decoded) ? $decoded : null;
    }

    public static function inject_plugin_update($transient) {
        if (!is_object($transient) || empty($transient->checked)) {
            return $transient;
        }

        $plugin_file = self::get_plugin_basename();
        $current_version = isset($transient->checked[$plugin_file])
            ? (string) $transient->checked[$plugin_file]
            : self::VERSION;

        $metadata = self::fetch_update_metadata();
        if (!$metadata || empty($metadata['version']) || empty($metadata['download_url'])) {
            return $transient;
        }

        if (version_compare($metadata['version'], $current_version, '<=')) {
            return $transient;
        }

        $update = new stdClass();
        $update->slug = 'adnova-pixel';
        $update->plugin = $plugin_file;
        $update->new_version = $metadata['version'];
        $update->url = isset($metadata['homepage']) ? $metadata['homepage'] : '';
        $update->package = $metadata['download_url'];
        $update->tested = isset($metadata['tested']) ? $metadata['tested'] : '';
        $update->requires = isset($metadata['requires']) ? $metadata['requires'] : '';
        $update->requires_php = isset($metadata['requires_php']) ? $metadata['requires_php'] : '';

        if (!isset($transient->response) || !is_object($transient->response)) {
            $transient->response = new stdClass();
        }
        if (!isset($transient->no_update) || !is_object($transient->no_update)) {
            $transient->no_update = new stdClass();
        }

        $transient->response->{$plugin_file} = $update;
        if (isset($transient->no_update->{$plugin_file})) {
            unset($transient->no_update->{$plugin_file});
        }

        return $transient;
    }

    public static function plugins_api_handler($result, $action, $args) {
        if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== 'adnova-pixel') {
            return $result;
        }

        $metadata = self::fetch_update_metadata();
        if (!$metadata) {
            return $result;
        }

        $info = new stdClass();
        $info->name = isset($metadata['name']) ? $metadata['name'] : 'Adnova Pixel';
        $info->slug = 'adnova-pixel';
        $info->version = isset($metadata['version']) ? $metadata['version'] : self::VERSION;
        $info->homepage = isset($metadata['homepage']) ? $metadata['homepage'] : '';
        $info->download_link = isset($metadata['download_url']) ? $metadata['download_url'] : '';
        $info->requires = isset($metadata['requires']) ? $metadata['requires'] : '';
        $info->tested = isset($metadata['tested']) ? $metadata['tested'] : '';
        $info->requires_php = isset($metadata['requires_php']) ? $metadata['requires_php'] : '';
        $info->last_updated = isset($metadata['last_updated']) ? $metadata['last_updated'] : '';
        $info->sections = isset($metadata['sections']) && is_array($metadata['sections']) ? $metadata['sections'] : array();
        $info->banners = isset($metadata['banners']) && is_array($metadata['banners']) ? $metadata['banners'] : array();

        return $info;
    }

    public static function enable_auto_update($update, $item) {
        if (is_object($item) && isset($item->plugin) && $item->plugin === self::get_plugin_basename()) {
            return true;
        }

        return $update;
    }

    public static function enqueue_pixel_script() {
        if (is_admin()) {
            return;
        }

        $script_url = esc_url_raw(get_option(self::OPTION_SCRIPT_URL, self::DEFAULT_SCRIPT_URL));
        if (!$script_url) {
            $script_url = self::DEFAULT_SCRIPT_URL;
        }

        // Load in footer to survive themes that skip or alter wp_head output.
        wp_register_script('adnova-pixel', $script_url, array(), self::VERSION, true);

        // Inject logged-in Woo customer context BEFORE pixel execution.
        $user_payload = self::get_logged_in_customer_payload();
        if (!empty($user_payload)) {
            wp_add_inline_script(
                'adnova-pixel',
                'window.adnova_user_data=' . wp_json_encode($user_payload) . ';',
                'before'
            );
        }

        wp_enqueue_script('adnova-pixel');
    }

    public static function ensure_pixel_fallback_tag() {
        if (is_admin()) {
            return;
        }

        // If WordPress printed the script, no fallback is needed.
        if (wp_script_is('adnova-pixel', 'done')) {
            return;
        }

        $script_url = esc_url_raw(get_option(self::OPTION_SCRIPT_URL, self::DEFAULT_SCRIPT_URL));
        if (!$script_url) {
            $script_url = self::DEFAULT_SCRIPT_URL;
        }

        $site_id = self::get_site_id();
        $user_payload = self::get_logged_in_customer_payload();

        if (!empty($user_payload)) {
            echo '<script>window.adnova_user_data=' . wp_json_encode($user_payload) . ';</script>';
        }

        echo '<script src="' . esc_url($script_url) . '" data-account-id="' . esc_attr($site_id) . '" data-site-id="' . esc_attr($site_id) . '" defer></script>';
    }

    public static function inject_script_attributes($tag, $handle, $src) {
        if ($handle !== 'adnova-pixel') {
            return $tag;
        }

        $site_id = self::get_site_id();
        $safe_src = esc_url($src);
        $user_payload = self::get_logged_in_customer_payload();

        $attrs = array(
            'src="' . $safe_src . '"',
            'data-account-id="' . esc_attr($site_id) . '"',
            'data-site-id="' . esc_attr($site_id) . '"',
            'defer',
        );

        if (!empty($user_payload) && !empty($user_payload['customer_id'])) {
            $attrs[] = 'data-customer-id="' . esc_attr((string) $user_payload['customer_id']) . '"';
            if (!empty($user_payload['email'])) {
                $attrs[] = 'data-customer-email="' . esc_attr((string) $user_payload['email']) . '"';
            }
            if (!empty($user_payload['phone'])) {
                $attrs[] = 'data-customer-phone="' . esc_attr((string) $user_payload['phone']) . '"';
            }
            if (!empty($user_payload['customer_name'])) {
                $attrs[] = 'data-customer-name="' . esc_attr((string) $user_payload['customer_name']) . '"';
            }
            if (!empty($user_payload['customer_first_name'])) {
                $attrs[] = 'data-customer-first-name="' . esc_attr((string) $user_payload['customer_first_name']) . '"';
            }
            if (!empty($user_payload['customer_last_name'])) {
                $attrs[] = 'data-customer-last-name="' . esc_attr((string) $user_payload['customer_last_name']) . '"';
            }
            if (!empty($user_payload['billing_company'])) {
                $attrs[] = 'data-billing-company="' . esc_attr((string) $user_payload['billing_company']) . '"';
            }
        }

        return '<script ' . implode(' ', $attrs) . '></script>';
    }

    private static function get_site_id() {
        $saved = get_option(self::OPTION_SITE_ID);
        if (is_string($saved) && $saved !== '') {
            return $saved;
        }

        $detected = self::detect_site_id();
        update_option(self::OPTION_SITE_ID, $detected, false);
        return $detected;
    }

    private static function detect_site_id() {
        $host = parse_url(home_url('/'), PHP_URL_HOST);

        if (!is_string($host) || $host === '') {
            $host = isset($_SERVER['HTTP_HOST']) ? wp_unslash($_SERVER['HTTP_HOST']) : '';
        }

        $host = strtolower(trim((string) $host));
        $host = preg_replace('/^www\./', '', $host);

        if ($host === '') {
            return 'unknown-site';
        }

        return sanitize_text_field($host);
    }

    private static function get_order_meta_first($order, $keys) {
        if (!$order || !is_array($keys)) {
            return '';
        }

        foreach ($keys as $key) {
            $value = (string) $order->get_meta($key, true);
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }

    private static function get_order_subtotal_amount($order) {
        if (!$order) {
            return 0.0;
        }

        $subtotal = 0.0;
        foreach ($order->get_items() as $item) {
            if (method_exists($item, 'get_subtotal')) {
                $subtotal += (float) $item->get_subtotal();
            } else {
                $subtotal += (float) $item->get_total();
            }
        }

        return $subtotal;
    }

    private static function get_order_customer_identity($order) {
        if (!$order) {
            return array(
                'customer_name' => null,
                'customer_first_name' => null,
                'customer_last_name' => null,
                'billing_company' => null,
                'customer_email' => null,
                'customer_phone' => null,
            );
        }

        $first_name = sanitize_text_field((string) $order->get_billing_first_name());
        $last_name = sanitize_text_field((string) $order->get_billing_last_name());
        $company = sanitize_text_field((string) $order->get_billing_company());
        
        $email = sanitize_text_field((string) $order->get_billing_email());
        $phone = sanitize_text_field((string) $order->get_billing_phone());

        if ($first_name === '' && $last_name === '') {
            $first_name = sanitize_text_field((string) $order->get_shipping_first_name());
            $last_name = sanitize_text_field((string) $order->get_shipping_last_name());
        }

        if ($company === '') {
            $company = sanitize_text_field((string) $order->get_shipping_company());
        }

        $customer_name = trim($first_name . ' ' . $last_name);
        if ($customer_name === '') {
            $customer_name = $company;
        }

        return array(
            'customer_name' => $customer_name !== '' ? $customer_name : null,
            'customer_first_name' => $first_name !== '' ? $first_name : null,
            'customer_last_name' => $last_name !== '' ? $last_name : null,
            'billing_company' => $company !== '' ? $company : null,
            'customer_email' => $email !== '' ? $email : null,
            'customer_phone' => $phone !== '' ? $phone : null,
        );
    }

    private static function get_logged_in_customer_payload() {
        if (is_admin() || !is_user_logged_in()) {
            return null;
        }

        $user = wp_get_current_user();
        if (!$user || !$user->exists()) {
            return null;
        }

        $customer_id = (string) $user->ID;
        if ($customer_id === '') {
            return null;
        }

        $email = sanitize_email((string) $user->user_email);
        $first_name = sanitize_text_field((string) get_user_meta($user->ID, 'first_name', true));
        $last_name = sanitize_text_field((string) get_user_meta($user->ID, 'last_name', true));
        $phone = sanitize_text_field((string) get_user_meta($user->ID, 'billing_phone', true));
        $company = sanitize_text_field((string) get_user_meta($user->ID, 'billing_company', true));
        $full_name = trim($first_name . ' ' . $last_name);

        if ($full_name === '') {
            $full_name = sanitize_text_field((string) $user->display_name);
        }

        if ($full_name === '') {
            $full_name = $company;
        }

        return array(
            'customer_id' => $customer_id,
            'email' => $email !== '' ? $email : null,
            'phone' => $phone !== '' ? $phone : null,
            'customer_name' => $full_name !== '' ? $full_name : null,
            'customer_first_name' => $first_name !== '' ? $first_name : null,
            'customer_last_name' => $last_name !== '' ? $last_name : null,
            'billing_company' => $company !== '' ? $company : null,
        );
    }

    public static function inject_logged_in_customer_context() {
        $payload = self::get_logged_in_customer_payload();
        if (empty($payload)) {
            return;
        }

        echo '<script>window.adnova_user_data=' . wp_json_encode($payload) . ';</script>' . "\n";
    }

    private static function get_order_attribution_data($order) {
        if (!$order) {
            return array();
        }

        $meta = array(
            'utm_source'   => self::get_order_meta_first($order, array('_wc_order_attribution_utm_source', 'wc_order_attribution_utm_source', '_utm_source')),
            'utm_medium'   => self::get_order_meta_first($order, array('_wc_order_attribution_utm_medium', 'wc_order_attribution_utm_medium', '_utm_medium')),
            'utm_campaign' => self::get_order_meta_first($order, array('_wc_order_attribution_utm_campaign', 'wc_order_attribution_utm_campaign', '_utm_campaign')),
            'utm_content'  => self::get_order_meta_first($order, array('_wc_order_attribution_utm_content', 'wc_order_attribution_utm_content', '_utm_content')),
            'utm_term'     => self::get_order_meta_first($order, array('_wc_order_attribution_utm_term', 'wc_order_attribution_utm_term', '_utm_term')),
            'referrer'     => self::get_order_meta_first($order, array('_wc_order_attribution_referrer', 'wc_order_attribution_referrer', '_referrer')),
            'gclid'        => self::get_order_meta_first($order, array('_wc_order_attribution_gclid', 'wc_order_attribution_gclid', '_gclid')),
            'fbclid'       => self::get_order_meta_first($order, array('_wc_order_attribution_fbclid', 'wc_order_attribution_fbclid', '_fbclid')),
            'ttclid'       => self::get_order_meta_first($order, array('_wc_order_attribution_ttclid', 'wc_order_attribution_ttclid', '_ttclid')),
            'woo_source_type' => self::get_order_meta_first($order, array('_wc_order_attribution_source_type', 'wc_order_attribution_source_type')),
            'woo_session_source' => self::get_order_meta_first($order, array('_wc_order_attribution_session_source', 'wc_order_attribution_session_source')),
        );

        $session_entry = (string) $order->get_meta('_wc_order_attribution_session_entry', true);

        // Cookie fallback for stores that keep click IDs client-side.
        $cookie_map = array(
            'utm_source' => 'utm_source',
            'utm_medium' => 'utm_medium',
            'utm_campaign' => 'utm_campaign',
            'utm_content' => 'utm_content',
            'utm_term' => 'utm_term',
            'gclid' => 'gclid',
            'fbclid' => 'fbclid',
            'ttclid' => 'ttclid',
        );

        foreach ($cookie_map as $field => $cookie_key) {
            if ($meta[$field] !== '') {
                continue;
            }
            if (isset($_COOKIE[$cookie_key])) {
                $meta[$field] = sanitize_text_field(wp_unslash($_COOKIE[$cookie_key]));
            }
        }

        foreach ($meta as $key => $value) {
            $meta[$key] = $value !== '' ? sanitize_text_field($value) : null;
        }

        $source_label = null;
        $source_type = isset($meta['woo_source_type']) && $meta['woo_source_type']
            ? strtolower($meta['woo_source_type'])
            : null;

        if (!empty($meta['utm_source'])) {
            if ($source_type === 'organic') {
                $source_label = 'Orgánico: ' . ucfirst($meta['utm_source']);
            } else {
                $source_label = ucfirst($meta['utm_source']);
            }
        } elseif (!empty($meta['woo_session_source'])) {
            $source_label = ucfirst($meta['woo_session_source']);
        } elseif ($source_type === 'direct') {
            $source_label = 'Directo';
        } elseif ($source_type === 'organic' && !empty($meta['referrer'])) {
            $host = parse_url($meta['referrer'], PHP_URL_HOST);
            if (is_string($host) && $host !== '') {
                $source_label = 'Orgánico: ' . ucfirst(preg_replace('/^www\./', '', $host));
            }
        } elseif (!empty($session_entry)) {
            $entry_host = parse_url($session_entry, PHP_URL_HOST);
            if (is_string($entry_host) && $entry_host !== '') {
                $source_label = ucfirst(preg_replace('/^www\./', '', $entry_host));
            }
        }

        if (!$source_label) {
            $source_label = 'Desconocido';
        }

        $meta['woo_source_label'] = sanitize_text_field($source_label);

        return $meta;
    }

    /**
     * WooCommerce thank-you page: inject order data for the browser pixel
     * AND fire a server-side backup purchase event to /collect.
     *
     * The browser fires event_id='brw_wc_{order_id}'; server uses 'srv_wc_{order_id}'.
     * Both carry order_id so the dashboard can deduplicate revenue by order_id at query time.
     */
    public static function on_woo_order_received($order_id) {
        self::track_woo_order_purchase($order_id, true);
    }

    public static function on_woo_order_server_side($order_id) {
        self::track_woo_order_purchase($order_id, false);
    }

    public static function on_woo_order_refunded($order_id, $refund_id = 0) {
        if (!$order_id) {
            return;
        }

        self::sync_woo_order_to_backend((int) $order_id);
        self::send_server_side_event('order_refunded', array(
            'order_id' => (string) $order_id,
            'refund_id' => $refund_id ? (string) $refund_id : null,
            'raw_source' => 'plugin_server',
            'page_type' => 'checkout',
            'page_url' => home_url('/mi-cuenta/orders/'),
        ));
    }

    public static function save_pixel_cookies_to_order($order_id) {
        $order = wc_get_order($order_id);
        if ($order) {
            if (isset($_COOKIE['__adray_session_id'])) {
                $order->update_meta_data('_adray_session_id', sanitize_text_field(wp_unslash($_COOKIE['__adray_session_id'])));
            }
            if (isset($_COOKIE['__adray_visitor_id'])) {
                $order->update_meta_data('_adray_visitor_id', sanitize_text_field(wp_unslash($_COOKIE['__adray_visitor_id'])));
            }
            $order->save();
        }
    }

    public static function track_wp_login_event($user_login, $user) {
        if (!$user || !($user instanceof WP_User)) {
            return;
        }

        // Ignore admin/editor logins; we only care about storefront customer identity stitching.
        $roles = is_array($user->roles) ? $user->roles : array();
        if (!in_array('customer', $roles, true)) {
            return;
        }

        $session_id = null;
        if (isset($_COOKIE['__adray_session_id'])) {
            $session_id = sanitize_text_field(wp_unslash($_COOKIE['__adray_session_id']));
        }

        $first_name = sanitize_text_field((string) get_user_meta($user->ID, 'first_name', true));
        $last_name = sanitize_text_field((string) get_user_meta($user->ID, 'last_name', true));
        $phone = sanitize_text_field((string) get_user_meta($user->ID, 'billing_phone', true));
        $company = sanitize_text_field((string) get_user_meta($user->ID, 'billing_company', true));
        $email = sanitize_email((string) $user->user_email);
        $full_name = trim($first_name . ' ' . $last_name);

        if ($full_name === '') {
            $full_name = sanitize_text_field((string) $user->display_name);
        }

        $page_url = home_url('/mi-cuenta/');
        $referer = wp_get_referer();
        if (is_string($referer) && $referer !== '') {
            $page_url = esc_url_raw($referer);
        }

        self::send_server_side_event('user_logged_in', array(
            'session_id' => $session_id,
            'customer_id' => (string) $user->ID,
            'email' => $email !== '' ? $email : null,
            'phone' => $phone !== '' ? $phone : null,
            'customer_name' => $full_name !== '' ? $full_name : null,
            'customer_first_name' => $first_name !== '' ? $first_name : null,
            'customer_last_name' => $last_name !== '' ? $last_name : null,
            'billing_company' => $company !== '' ? $company : null,
            'page_type' => 'account',
            'page_url' => $page_url,
            'login_detected_from' => 'wp_login_hook',
        ));
    }

    public static function track_wp_logout_event() {
        $user = wp_get_current_user();
        if (!$user || !($user instanceof WP_User) || !$user->exists()) {
            return;
        }

        $roles = is_array($user->roles) ? $user->roles : array();
        if (!in_array('customer', $roles, true)) {
            return;
        }

        $session_id = null;
        if (isset($_COOKIE['__adray_session_id'])) {
            $session_id = sanitize_text_field(wp_unslash($_COOKIE['__adray_session_id']));
        }

        self::send_server_side_event('user_logged_out', array(
            'session_id' => $session_id,
            'customer_id' => (string) $user->ID,
            'page_type' => 'account',
            'page_url' => esc_url_raw(home_url('/mi-cuenta/')),
            'logout_detected_from' => 'wp_logout_hook',
        ));
    }

    public static function backfill_recent_orders() {
        if (!function_exists('wc_get_orders')) {
            return;
        }

        $done_version = get_option(self::OPTION_BACKFILL_DONE, '');
        if ($done_version === self::VERSION) {
            return;
        }

        $orders = wc_get_orders(array(
            'limit' => 100,
            'orderby' => 'date',
            'order' => 'DESC',
            'status' => array('processing', 'completed', 'on-hold'),
            'return' => 'ids',
        ));

        foreach ($orders as $order_id) {
            self::sync_woo_order_to_backend($order_id);
        }

        update_option(self::OPTION_BACKFILL_DONE, self::VERSION, false);
    }

    private static function track_woo_order_purchase($order_id, $inject_browser) {
        if (!$order_id || !function_exists('wc_get_order')) {
            return;
        }

        $order_id = (int) $order_id;
        if ($order_id <= 0) {
            return;
        }

        if (in_array($order_id, self::$processed_orders, true)) {
            return;
        }
        self::$processed_orders[] = $order_id;

        $order = wc_get_order($order_id);
        if (!$order) {
            return;
        }

        $already_sent = (bool) $order->get_meta('_adnova_purchase_sent', true);

        // Build items list
        $items = array();
        foreach ($order->get_items() as $item) {
            $product  = $item->get_product();
            $qty      = max(1, (int) $item->get_quantity());
            $items[]  = array(
                'id'       => $product ? (string) $product->get_id() : null,
                'name'     => $item->get_name(),
                'quantity' => $qty,
                'price'    => round((float) $item->get_total() / $qty, 2),
            );
        }

        $attribution_data = self::get_order_attribution_data($order);

        $order_data = array_merge(
            array(
                'order_id'       => (string) $order_id,
                'revenue'        => (float) $order->get_total(),
                'currency'       => $order->get_currency(),
                'checkout_token' => $order->get_cart_hash(),
                'items'          => $items,
            ),
            $attribution_data
        );

        if ($inject_browser) {
            // Inject data for browser pixel (picks it up in section 5 of adray-pixel.js)
            echo '<script>window.adnova_order_data=' . wp_json_encode($order_data) . ';</script>' . "\n";
        }

        if ($already_sent) {
            self::sync_woo_order_to_backend($order_id, $order, $order_data);
            return;
        }

        // Server-side backup: fires even if the browser blocks the pixel
        self::send_server_side_event('purchase', array(
            'event_id'       => 'srv_wc_' . $order_id,
            'raw_source'     => 'plugin_server',
            'page_url'       => $order->get_checkout_order_received_url(),
            'page_type'      => 'checkout',
            'order_id'       => $order_data['order_id'],
            'revenue'        => $order_data['revenue'],
            'currency'       => $order_data['currency'],
            'checkout_token' => $order_data['checkout_token'],
            'items'          => $order_data['items'],
            'utm_source'     => isset($order_data['utm_source']) ? $order_data['utm_source'] : null,
            'utm_medium'     => isset($order_data['utm_medium']) ? $order_data['utm_medium'] : null,
            'utm_campaign'   => isset($order_data['utm_campaign']) ? $order_data['utm_campaign'] : null,
            'utm_content'    => isset($order_data['utm_content']) ? $order_data['utm_content'] : null,
            'utm_term'       => isset($order_data['utm_term']) ? $order_data['utm_term'] : null,
            'referrer'       => isset($order_data['referrer']) ? $order_data['referrer'] : null,
            'gclid'          => isset($order_data['gclid']) ? $order_data['gclid'] : null,
            'fbclid'         => isset($order_data['fbclid']) ? $order_data['fbclid'] : null,
            'ttclid'         => isset($order_data['ttclid']) ? $order_data['ttclid'] : null,
            'woo_source_label' => isset($order_data['woo_source_label']) ? $order_data['woo_source_label'] : null,
            'woo_source_type'  => isset($order_data['woo_source_type']) ? $order_data['woo_source_type'] : null,
            'woo_session_source' => isset($order_data['woo_session_source']) ? $order_data['woo_session_source'] : null,
        ));

        $order->update_meta_data('_adnova_purchase_sent', gmdate('c'));
        $order->save();
        self::sync_woo_order_to_backend($order_id, $order, $order_data);
    }

    private static function sync_woo_order_to_backend($order_id, $order = null, $order_data = null) {
        if (!function_exists('wc_get_order')) {
            return;
        }

        $order_id = (int) $order_id;
        if ($order_id <= 0) {
            return;
        }

        if (!$order) {
            $order = wc_get_order($order_id);
        }
        if (!$order) {
            return;
        }

        if (!$order_data) {
            $items = array();
            foreach ($order->get_items() as $item) {
                $product  = $item->get_product();
                $qty      = max(1, (int) $item->get_quantity());
                $items[]  = array(
                    'id'       => $product ? (string) $product->get_id() : null,
                    'name'     => $item->get_name(),
                    'quantity' => $qty,
                    'price'    => round((float) $item->get_total() / $qty, 2),
                );
            }

            $order_data = array_merge(
                array(
                    'order_id'       => (string) $order_id,
                    'revenue'        => (float) $order->get_total(),
                    'currency'       => $order->get_currency(),
                    'checkout_token' => $order->get_cart_hash(),
                    'items'          => $items,
                ),
                self::get_order_attribution_data($order)
            );
        }

        $customer_identity = self::get_order_customer_identity($order);
        $customer_id_value = $order->get_customer_id();
        $orders_count = null;
        if ($customer_id_value && function_exists('wc_get_customer_order_count')) {
            $orders_count = (int) wc_get_customer_order_count($customer_id_value);
        }
        $refund_amount = (float) $order->get_total_refunded();
        $chargeback_flag = self::detect_chargeback_flag($order);
        $order_created_at = $order->get_date_created();
        $order_created_at_local = $order_created_at ? $order_created_at->date('c') : gmdate('c');
        $order_created_at_gmt = $order_created_at ? $order_created_at->setTimezone(new DateTimeZone('UTC'))->format('c') : gmdate('c');
        $order_created_at_offset_seconds = $order_created_at ? (int) $order_created_at->getOffset() : 0;

        $payload = array(
            'account_id' => self::get_site_id(),
            'session_id' => $order->get_meta('_adray_session_id') ? $order->get_meta('_adray_session_id') : null,
            'user_key' => $order->get_meta('_adray_visitor_id') ? $order->get_meta('_adray_visitor_id') : null,
            'raw_source' => 'plugin_order_sync',
            'collected_at' => gmdate('c'),
            'order_id' => $order_data['order_id'],
            'order_number' => (string) $order->get_order_number(),
            'checkout_token' => isset($order_data['checkout_token']) ? $order_data['checkout_token'] : null,
            'customer_id' => $customer_id_value ? (string) $customer_id_value : null,
            'orders_count' => $orders_count,
            'customer_name' => $customer_identity['customer_name'],
            'customer_first_name' => $customer_identity['customer_first_name'],
            'customer_last_name' => $customer_identity['customer_last_name'],
            'billing_company' => $customer_identity['billing_company'],
            'customer_email' => $customer_identity['customer_email'],
            'customer_phone' => $customer_identity['customer_phone'],
            'revenue' => isset($order_data['revenue']) ? $order_data['revenue'] : (float) $order->get_total(),
            'subtotal' => self::get_order_subtotal_amount($order),
            'discount_total' => (float) $order->get_discount_total(),
            'shipping_total' => (float) $order->get_shipping_total(),
            'tax_total' => (float) $order->get_total_tax(),
            'refund_amount' => $refund_amount,
            'chargeback_flag' => $chargeback_flag,
            'currency' => isset($order_data['currency']) ? $order_data['currency'] : $order->get_currency(),
            'items' => isset($order_data['items']) ? $order_data['items'] : array(),
            'created_at' => $order_created_at_local,
            'created_at_gmt' => $order_created_at_gmt,
            'created_at_offset_seconds' => $order_created_at_offset_seconds,
            'utm_source' => isset($order_data['utm_source']) ? $order_data['utm_source'] : null,
            'utm_medium' => isset($order_data['utm_medium']) ? $order_data['utm_medium'] : null,
            'utm_campaign' => isset($order_data['utm_campaign']) ? $order_data['utm_campaign'] : null,
            'utm_content' => isset($order_data['utm_content']) ? $order_data['utm_content'] : null,
            'utm_term' => isset($order_data['utm_term']) ? $order_data['utm_term'] : null,
            'referrer' => isset($order_data['referrer']) ? $order_data['referrer'] : null,
            'gclid' => isset($order_data['gclid']) ? $order_data['gclid'] : null,
            'fbclid' => isset($order_data['fbclid']) ? $order_data['fbclid'] : null,
            'ttclid' => isset($order_data['ttclid']) ? $order_data['ttclid'] : null,
            'woo_source_label' => isset($order_data['woo_source_label']) ? $order_data['woo_source_label'] : null,
            'woo_source_type' => isset($order_data['woo_source_type']) ? $order_data['woo_source_type'] : null,
            'woo_session_source' => isset($order_data['woo_session_source']) ? $order_data['woo_session_source'] : null,
        );

        $response = wp_remote_post(
            self::DEFAULT_ORDER_SYNC_URL,
            array(
                'timeout'  => 12,
                'blocking' => true,
                'headers'  => array(
                    'Content-Type' => 'application/json',
                ),
                'body'     => wp_json_encode($payload),
            )
        );

        if (is_wp_error($response)) {
            error_log('[Adnova Pixel] Woo sync failed for order ' . (string) $order_id . ': ' . $response->get_error_message());
            return;
        }

        $status_code = (int) wp_remote_retrieve_response_code($response);
        if ($status_code >= 300 || $status_code < 200) {
            error_log('[Adnova Pixel] Woo sync non-2xx for order ' . (string) $order_id . ': HTTP ' . (string) $status_code);
        }
    }

    /**
     * Fallback detector for thank-you pages where the standard Woo hook may not fire.
     */
    public static function maybe_track_woo_order_received_fallback() {
        if (!function_exists('is_order_received_page') || !is_order_received_page()) {
            return;
        }

        $order_id = 0;

        $qv = get_query_var('order-received');
        if ($qv) {
            $order_id = (int) $qv;
        }

        if ($order_id <= 0 && isset($_GET['order-received'])) {
            $order_id = (int) wp_unslash($_GET['order-received']);
        }

        if ($order_id <= 0 && isset($_GET['key']) && function_exists('wc_get_order_id_by_order_key')) {
            $order_key = sanitize_text_field(wp_unslash($_GET['key']));
            $order_id = (int) wc_get_order_id_by_order_key($order_key);
        }

        if ($order_id > 0) {
            self::on_woo_order_received($order_id);
        }
    }

    /**
     * Generic server-side event sender — POSTs directly to /collect.
     */
    private static function send_server_side_event($event_name, array $extra = array()) {
        $site_id = self::get_site_id();

        $payload = array_merge(
            array(
                'account_id' => $site_id,
                'platform'   => 'woocommerce',
                'event_name' => $event_name,
                'page_url'   => home_url('/'),
                'raw_source' => 'plugin_server',
            ),
            $extra
        );

        wp_remote_post(
            self::DEFAULT_COLLECT_URL,
            array(
                'timeout'  => 5,
                'blocking' => false,   // non-blocking: don't slow down the page
                'headers'  => array(
                    'Content-Type' => 'application/json',
                ),
                'body'     => wp_json_encode($payload),
            )
        );
    }

    private static function send_activation_ping() {
        self::send_server_side_event('plugin_activated', array(
            'page_url'       => home_url('/'),
            'page_type'      => 'home',
            'plugin_version' => self::VERSION,
        ));
    }

    private static function detect_chargeback_flag($order) {
        if (!$order) {
            return false;
        }

        $status = strtolower((string) $order->get_status());
        $status_markers = array('chargeback', 'dispute', 'fraud');
        foreach ($status_markers as $marker) {
            if (strpos($status, $marker) !== false) {
                return true;
            }
        }

        $meta_keys = array(
            '_stripe_dispute_status',
            '_wcpay_dispute_status',
            '_paypal_dispute_status',
            '_adnova_chargeback_flag',
        );

        foreach ($meta_keys as $meta_key) {
            $value = strtolower((string) $order->get_meta($meta_key, true));
            if ($value === '') {
                continue;
            }
            if (strpos($value, 'chargeback') !== false || strpos($value, 'dispute') !== false || strpos($value, 'lost') !== false) {
                return true;
            }
        }

        return false;
    }
}

Adnova_Pixel_Plugin::init();
