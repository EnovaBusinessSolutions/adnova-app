<?php
/**
 * Plugin Name: Adnova Pixel
 * Plugin URI: https://adnova.ai
 * Description: Instala automaticamente el pixel de Adnova en tu sitio WordPress y usa el dominio como Site ID.
 * Version: 1.0.0
 * Author: Adnova
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: adnova-pixel
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Adnova_Pixel_Plugin {
    const VERSION = '1.0.0';
    const OPTION_SCRIPT_URL = 'adnova_pixel_script_url';
    const OPTION_SITE_ID = 'adnova_pixel_site_id';
    const DEFAULT_SCRIPT_URL = 'https://adray-app-staging-german.onrender.com/adray-pixel.js';
    const DEFAULT_COLLECT_URL = 'https://adray-app-staging-german.onrender.com/collect';

    public static function init() {
        register_activation_hook(__FILE__, array(__CLASS__, 'on_activate'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'enqueue_pixel_script'), 100);
        add_filter('script_loader_tag', array(__CLASS__, 'inject_script_attributes'), 10, 3);
        // WooCommerce: fire purchase on thank-you page
        add_action('woocommerce_thankyou', array(__CLASS__, 'on_woo_order_received'), 10, 1);
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

    /**
     * WooCommerce thank-you page: inject order data for the browser pixel
     * AND fire a server-side backup purchase event to /collect.
     *
     * The browser fires event_id='brw_wc_{order_id}'; server uses 'srv_wc_{order_id}'.
     * Both carry order_id so the dashboard can deduplicate revenue by order_id at query time.
     */
    public static function on_woo_order_received($order_id) {
        if (!$order_id) {
            return;
        }

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

        $order_data = array(
            'order_id'       => (string) $order_id,
            'revenue'        => (float) $order->get_total(),
            'currency'       => $order->get_currency(),
            'checkout_token' => $order->get_cart_hash(),
            'items'          => $items,
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
        ));
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
