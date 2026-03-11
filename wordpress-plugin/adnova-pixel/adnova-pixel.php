<?php
/**
 * Plugin Name: Adnova Pixel
 * Plugin URI: https://adnova.ai
 * Description: Instala automaticamente el pixel de Adnova en tu sitio WordPress y usa el dominio como Site ID.
 * Version: 1.0.2
 * Author: Adnova
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: adnova-pixel
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Adnova_Pixel_Plugin {
    const VERSION = '1.0.2';
    const OPTION_SCRIPT_URL = 'adnova_pixel_script_url';
    const OPTION_SITE_ID = 'adnova_pixel_site_id';
    const DEFAULT_SCRIPT_URL = 'https://adray-app-staging-german.onrender.com/adray-pixel.js';
    const DEFAULT_COLLECT_URL = 'https://adray-app-staging-german.onrender.com/collect';
    private static $processed_orders = array();

    public static function init() {
        register_activation_hook(__FILE__, array(__CLASS__, 'on_activate'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'enqueue_pixel_script'), 100);
        add_filter('script_loader_tag', array(__CLASS__, 'inject_script_attributes'), 10, 3);
        // WooCommerce: fire purchase on thank-you page
        add_action('woocommerce_thankyou', array(__CLASS__, 'on_woo_order_received'), 10, 1);
        // Fallback for custom checkout flows/themes where woocommerce_thankyou is bypassed.
        add_action('wp_footer', array(__CLASS__, 'maybe_track_woo_order_received_fallback'), 1000);
    }

    public static function on_activate() {
        if (!get_option(self::OPTION_SCRIPT_URL)) {
            update_option(self::OPTION_SCRIPT_URL, self::DEFAULT_SCRIPT_URL, false);
        }

        if (!get_option(self::OPTION_SITE_ID)) {
            update_option(self::OPTION_SITE_ID, self::detect_site_id(), false);
        }

        self::send_activation_ping();
    }

    public static function enqueue_pixel_script() {
        if (is_admin()) {
            return;
        }

        $script_url = esc_url_raw(get_option(self::OPTION_SCRIPT_URL, self::DEFAULT_SCRIPT_URL));
        if (!$script_url) {
            $script_url = self::DEFAULT_SCRIPT_URL;
        }

        wp_register_script('adnova-pixel', $script_url, array(), self::VERSION, false);
        wp_enqueue_script('adnova-pixel');
    }

    public static function inject_script_attributes($tag, $handle, $src) {
        if ($handle !== 'adnova-pixel') {
            return $tag;
        }

        $site_id = self::get_site_id();
        $safe_src = esc_url($src);

        return sprintf(
            '<script src="%1$s" data-account-id="%2$s" data-site-id="%2$s" defer></script>',
            $safe_src,
            esc_attr($site_id)
        );
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

    private static function get_order_attribution_data($order) {
        if (!$order) {
            return array();
        }

        $meta = array(
            'utm_source'   => (string) $order->get_meta('_wc_order_attribution_utm_source', true),
            'utm_medium'   => (string) $order->get_meta('_wc_order_attribution_utm_medium', true),
            'utm_campaign' => (string) $order->get_meta('_wc_order_attribution_utm_campaign', true),
            'utm_content'  => (string) $order->get_meta('_wc_order_attribution_utm_content', true),
            'utm_term'     => (string) $order->get_meta('_wc_order_attribution_utm_term', true),
            'referrer'     => (string) $order->get_meta('_wc_order_attribution_referrer', true),
            'gclid'        => (string) $order->get_meta('_wc_order_attribution_gclid', true),
            'fbclid'       => (string) $order->get_meta('_wc_order_attribution_fbclid', true),
            'ttclid'       => (string) $order->get_meta('_wc_order_attribution_ttclid', true),
            'woo_source_type' => (string) $order->get_meta('_wc_order_attribution_source_type', true),
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

        // Inject data for browser pixel (picks it up in section 5 of adray-pixel.js)
        echo '<script>window.adnova_order_data=' . wp_json_encode($order_data) . ';</script>' . "\n";

        // Server-side backup: fires even if the browser blocks the pixel
        self::send_server_side_event('purchase', array(
            'event_id'       => 'srv_wc_' . $order_id,
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
        ));
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
}

Adnova_Pixel_Plugin::init();
