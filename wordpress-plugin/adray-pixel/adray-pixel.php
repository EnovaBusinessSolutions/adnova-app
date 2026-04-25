<?php
/**
 * Plugin Name: Adray Pixel
 * Plugin URI: https://adray.ai
 * Description: Instala automaticamente el pixel de Adray en tu sitio WordPress y usa el dominio como Site ID.
 * Version: 1.4.1
 * Author: Adray
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: adnova-pixel
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Adnova_Pixel_Plugin {
    const VERSION = '1.4.1';
    const OPTION_SCRIPT_URL = 'adnova_pixel_script_url';
    const OPTION_SITE_ID = 'adnova_pixel_site_id';
    const OPTION_CLARITY_ID = 'adnova_pixel_clarity_id';
    const OPTION_BACKFILL_DONE = 'adnova_pixel_backfill_done';
    const OPTION_MIGRATED_VERSION = 'adnova_pixel_migrated_version';
    const DEFAULT_SCRIPT_URL = 'https://adray.ai/adray-pixel.js';
    const DEFAULT_COLLECT_URL = 'https://adray.ai/collect';
    const DEFAULT_COLLECT_PATH = '/m/s';
    const DEFAULT_COLLECT_MS_URL = 'https://adray.ai/m/s';
    const DEFAULT_ORDER_SYNC_URL = 'https://adray.ai/api/woo/orders-sync';
    const DEFAULT_UPDATE_METADATA_URL = 'https://adray.ai/wp-plugin/adray-pixel/update.json';

    // Phase A — first-party proxy path. Events POSTed here by the pixel are
    // invisible to ad-blockers because the request is same-origin as the
    // storefront. The plugin forwards them server-side to the Adray backend.
    const PROXY_REST_NAMESPACE = 'adray/v1';
    const PROXY_REST_ROUTE = '/collect';

    // Server-side attribution (Phase B): first/last-touch snapshots are written
    // to HTTP-only cookies in `init`, before any browser JS runs. Ad-blockers
    // cannot intercept these because they never touch the wire for JS.
    const ATTRIB_FIRST_COOKIE = '_adray_srv_first';
    const ATTRIB_LAST_COOKIE = '_adray_srv_last';
    const ATTRIB_COOKIE_MAX_DAYS = 90;
    const ATTRIB_TRACKED_PARAMS = array(
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'fbclid', 'gclid', 'ttclid', 'wbraid', 'gbraid', 'msclkid',
    );

    private static $processed_orders = array();

    public static function init() {
        register_activation_hook(__FILE__, array(__CLASS__, 'on_activate'));
        // Phase B: capture UTMs + click IDs server-side before any JS runs.
        // Priority 1 so we write the cookie before template loads (and before
        // WP caches send headers).
        add_action('init', array(__CLASS__, 'capture_server_side_attribution'), 1);
        // Phase A: register first-party proxy endpoint at /wp-json/adray/v1/collect.
        add_action('rest_api_init', array(__CLASS__, 'register_proxy_endpoint'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'enqueue_pixel_script'), 100);
        add_action('wp_footer', array(__CLASS__, 'ensure_pixel_fallback_tag'), 999);
        add_filter('script_loader_tag', array(__CLASS__, 'inject_script_attributes'), 10, 3);
        add_action('admin_menu', array(__CLASS__, 'register_admin_menu'));
        add_action('admin_init', array(__CLASS__, 'register_settings'));
        // Enable auto-update infrastructure
        add_filter('pre_set_site_transient_update_plugins', array(__CLASS__, 'inject_plugin_update'));
        add_filter('plugins_api', array(__CLASS__, 'plugins_api_handler'), 10, 3);
        add_filter('auto_update_plugin', array(__CLASS__, 'enable_auto_update'), 10, 2);
        // WooCommerce: fire purchase on thank-you page
        add_action('woocommerce_thankyou', array(__CLASS__, 'on_woo_order_received'), 10, 1);
        // Server-side order capture even when thank-you is not rendered in browser.
        add_action('woocommerce_payment_complete', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_checkout_order_processed', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_processing', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_completed', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_on-hold', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_status_refunded', array(__CLASS__, 'on_woo_order_server_side'), 10, 1);
        add_action('woocommerce_order_refunded', array(__CLASS__, 'on_woo_order_refunded'), 10, 2);
        add_action('woocommerce_checkout_update_order_meta', array(__CLASS__, 'save_pixel_cookies_to_order'), 10, 1);
        add_action('wp_login', array(__CLASS__, 'track_wp_login_event'), 10, 2);
        add_action('wp_logout', array(__CLASS__, 'track_wp_logout_event'));
        add_action('wp_footer', array(__CLASS__, 'inject_logged_in_customer_context'), 20);
        // Fallback for custom checkout flows/themes where woocommerce_thankyou is bypassed.
        add_action('wp_footer', array(__CLASS__, 'maybe_track_woo_order_received_fallback'), 1000);
        add_action('adnova_pixel_backfill_orders', array(__CLASS__, 'backfill_recent_orders'), 10, 1);
        // Migrate stored URLs from staging to production on every load (cheap, exits early once done)
        add_action('plugins_loaded', array(__CLASS__, 'maybe_migrate_to_production'));
        // Direct backfill trigger from admin (no WP-Cron dependency)
        add_action('admin_post_adnova_run_backfill', array(__CLASS__, 'handle_admin_run_backfill'));
        self::maybe_schedule_backfill();
    }

    /**
     * One-time migration: update any stored staging URLs to production.
     * Runs on every plugins_loaded but exits early once version-keyed migration is done.
     */
    public static function maybe_migrate_to_production() {
        if (get_option(self::OPTION_MIGRATED_VERSION) === self::VERSION) {
            return;
        }

        $staging = 'https://adray-app-staging-german.onrender.com';

        $stored_script = get_option(self::OPTION_SCRIPT_URL);
        if ($stored_script && strpos($stored_script, $staging) !== false) {
            update_option(self::OPTION_SCRIPT_URL, str_replace($staging, 'https://adray.ai', $stored_script));
        }

        update_option(self::OPTION_MIGRATED_VERSION, self::VERSION);
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
            wp_schedule_single_event(time() + 30, 'adnova_pixel_backfill_orders', array(1));
        }

        delete_site_transient('update_plugins');
    }

    private static function maybe_schedule_backfill() {
        if (!function_exists('wc_get_orders')) {
            return;
        }

        $done_marker = get_option(self::OPTION_BACKFILL_DONE, '');
        if ($done_marker === self::get_backfill_marker()) {
            return;
        }

        if (!wp_next_scheduled('adnova_pixel_backfill_orders')) {
            wp_schedule_single_event(time() + 30, 'adnova_pixel_backfill_orders', array(1));
        }
    }

    private static function get_backfill_days() {
        $raw = isset($_ENV['ADRAY_WOO_BACKFILL_DAYS']) ? $_ENV['ADRAY_WOO_BACKFILL_DAYS'] : getenv('ADRAY_WOO_BACKFILL_DAYS');
        $raw = is_string($raw) ? trim($raw) : '';
        if ($raw === '' || strtolower($raw) === 'default') {
            return 365;
        }
        if (strtolower($raw) === 'all') {
            return 0;
        }
        $days = (int) $raw;
        if ($days <= 0) {
            return 0;
        }
        return max(1, min(3650, $days));
    }

    private static function get_backfill_marker() {
        return self::VERSION . ':days=' . self::get_backfill_days();
    }

    private static function get_plugin_basename() {
        return plugin_basename(__FILE__);
    }

    private static function fetch_update_metadata() {
        $url = self::DEFAULT_UPDATE_METADATA_URL . '?t=' . time();
        $response = wp_remote_get($url, array(
            'timeout' => 3,
            'headers' => array('Accept' => 'application/json'),
            'sslverify' => false,
        ));

        if (is_wp_error($response)) {
            return null;
        }

        $code = wp_remote_retrieve_response_code($response);
        if ($code < 200 || $code >= 300) {
            return null;
        }

        $body = wp_remote_retrieve_body($response);
        if (!is_string($body) || empty($body)) {
            return null;
        }
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
        $update->slug = 'adray-pixel';
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
        if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== 'adray-pixel') {
            return $result;
        }

        $metadata = self::fetch_update_metadata();
        if (!$metadata) {
            return $result;
        }

        $info = new stdClass();
        $info->name = isset($metadata['name']) ? $metadata['name'] : 'Adray Pixel';
        $info->slug = 'adray-pixel';
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

        // Phase A — tell the pixel to POST events to the first-party proxy
        // (same origin as the storefront), invisible to ad-blockers.
        $proxy_url = self::get_proxy_endpoint_url();
        if ($proxy_url) {
            wp_add_inline_script(
                'adnova-pixel',
                'window.adrayPixelConfig=Object.assign(window.adrayPixelConfig||{},{proxyEndpoint:' . wp_json_encode($proxy_url) . '});',
                'before'
            );
        }

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
        $clarity_id = self::get_clarity_id();
        $user_payload = self::get_logged_in_customer_payload();
        $proxy_url = self::get_proxy_endpoint_url();

        if ($proxy_url) {
            echo '<script>window.adrayPixelConfig=Object.assign(window.adrayPixelConfig||{},{proxyEndpoint:' . wp_json_encode($proxy_url) . '});</script>';
        }

        if (!empty($user_payload)) {
            echo '<script>window.adnova_user_data=' . wp_json_encode($user_payload) . ';</script>';
        }

        $clarity_attr = $clarity_id ? ' data-clarity-id="' . esc_attr($clarity_id) . '"' : '';
        $proxy_attr = $proxy_url ? ' data-proxy-endpoint="' . esc_attr($proxy_url) . '"' : '';
        echo '<script src="' . esc_url($script_url) . '" data-account-id="' . esc_attr($site_id) . '" data-site-id="' . esc_attr($site_id) . '"' . $clarity_attr . $proxy_attr . ' defer></script>';
    }

    public static function inject_script_attributes($tag, $handle, $src) {
        if ($handle !== 'adnova-pixel') {
            return $tag;
        }

        $site_id = self::get_site_id();
        $clarity_id = self::get_clarity_id();
        $proxy_url = self::get_proxy_endpoint_url();
        $safe_src = esc_url($src);
        $user_payload = self::get_logged_in_customer_payload();

        $attrs = array(
            'src="' . $safe_src . '"',
            'data-account-id="' . esc_attr($site_id) . '"',
            'data-site-id="' . esc_attr($site_id) . '"',
            'defer',
        );

        if ($clarity_id) {
            $attrs[] = 'data-clarity-id="' . esc_attr($clarity_id) . '"';
        }

        if ($proxy_url) {
            $attrs[] = 'data-proxy-endpoint="' . esc_attr($proxy_url) . '"';
        }

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

    /**
     * Returns the Microsoft Clarity project ID stored in WP options.
     * Returns empty string when not configured.
     */
    private static function get_clarity_id() {
        $saved = get_option(self::OPTION_CLARITY_ID, '');
        return is_string($saved) ? trim($saved) : '';
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

    /**
     * Phase A — first-party proxy.
     *
     * Registers POST+GET /wp-json/adray/v1/collect. The pixel POSTs events here
     * instead of directly to adray.ai; the plugin forwards them server-side.
     * Same-origin requests are invisible to Brave Shields / uBlock / AdBlock
     * Plus, because blocking them would also break the storefront itself.
     *
     * GET is supported for the Image-pixel fallback (?d=<base64url>) path used
     * when both sendBeacon and fetch are blocked.
     */
    public static function register_proxy_endpoint() {
        register_rest_route(self::PROXY_REST_NAMESPACE, self::PROXY_REST_ROUTE, array(
            array(
                'methods'             => 'POST',
                'callback'            => array(__CLASS__, 'handle_proxy_collect'),
                'permission_callback' => '__return_true',
            ),
            array(
                'methods'             => 'GET',
                'callback'            => array(__CLASS__, 'handle_proxy_collect'),
                'permission_callback' => '__return_true',
            ),
        ));
    }

    public static function handle_proxy_collect(WP_REST_Request $request) {
        $method = strtoupper($request->get_method());

        // Forward fire-and-forget to the Adray backend.
        self::forward_collect_to_backend($request);

        if ($method === 'GET') {
            // Image-pixel fallback: always respond with a 1×1 transparent GIF
            // so <img src="..."> loads without triggering onerror.
            $gif = base64_decode('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');
            if (!headers_sent()) {
                status_header(200);
                header('Content-Type: image/gif');
                header('Cache-Control: no-store, max-age=0');
                header('Pragma: no-cache');
                header('Content-Length: ' . strlen($gif));
            }
            echo $gif;
            exit;
        }

        // POST: 204 No Content is enough — the pixel ignores the body.
        return new WP_REST_Response(null, 204);
    }

    private static function forward_collect_to_backend(WP_REST_Request $request) {
        $method = strtoupper($request->get_method());

        // Target URL. The backend accepts both /collect and /m/s; we forward to
        // /m/s to keep path obscurity consistent with the pixel's default.
        $target = self::DEFAULT_COLLECT_MS_URL;

        $args = array(
            'method'    => $method,
            'timeout'   => 3,
            'blocking'  => false, // fire-and-forget; pixel doesn't care about body
            'sslverify' => true,
            'headers'   => self::build_forward_headers($request),
        );

        if ($method === 'GET') {
            $qs = isset($_SERVER['QUERY_STRING']) ? (string) $_SERVER['QUERY_STRING'] : '';
            if ($qs !== '') {
                $target .= '?' . $qs;
            }
        } else {
            $body = $request->get_body();
            if (is_string($body) && $body !== '') {
                $args['body'] = $body;
            }
        }

        wp_remote_request($target, $args);
    }

    private static function build_forward_headers(WP_REST_Request $request) {
        $headers = array(
            'X-Adray-Proxy' => 'wp-plugin/' . self::VERSION,
        );

        $content_type = $request->get_header('content-type');
        if (is_string($content_type) && $content_type !== '') {
            $headers['Content-Type'] = $content_type;
        } elseif (strtoupper($request->get_method()) !== 'GET') {
            $headers['Content-Type'] = 'application/json';
        }

        $ua = $request->get_header('user-agent');
        if (!$ua && !empty($_SERVER['HTTP_USER_AGENT'])) {
            $ua = wp_unslash($_SERVER['HTTP_USER_AGENT']);
        }
        if (is_string($ua) && $ua !== '') {
            $headers['User-Agent'] = $ua;
        }

        $client_ip = self::get_forward_client_ip();
        if ($client_ip !== '') {
            // Append-if-exists to preserve any upstream proxy chain.
            $existing_xff = $request->get_header('x-forwarded-for');
            if (is_string($existing_xff) && $existing_xff !== '') {
                $headers['X-Forwarded-For'] = $existing_xff . ', ' . $client_ip;
            } else {
                $headers['X-Forwarded-For'] = $client_ip;
            }
        }

        if (!empty($_SERVER['HTTP_HOST'])) {
            $headers['X-Forwarded-Host'] = sanitize_text_field(wp_unslash($_SERVER['HTTP_HOST']));
        }

        // Forward the original Cookie header so the backend can resolve the
        // pixel's identity cookies (__adray_session_id, __adray_visitor_id, etc.)
        $cookie_header = $request->get_header('cookie');
        if (!$cookie_header && !empty($_SERVER['HTTP_COOKIE'])) {
            $cookie_header = wp_unslash($_SERVER['HTTP_COOKIE']);
        }
        if (is_string($cookie_header) && $cookie_header !== '') {
            $headers['Cookie'] = $cookie_header;
        }

        $referer = $request->get_header('referer');
        if (!$referer && !empty($_SERVER['HTTP_REFERER'])) {
            $referer = wp_unslash($_SERVER['HTTP_REFERER']);
        }
        if (is_string($referer) && $referer !== '') {
            $headers['Referer'] = $referer;
        }

        return $headers;
    }

    private static function get_forward_client_ip() {
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            return sanitize_text_field(wp_unslash($_SERVER['HTTP_CF_CONNECTING_IP']));
        }
        if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
            return sanitize_text_field(wp_unslash($_SERVER['HTTP_X_REAL_IP']));
        }
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $xff = wp_unslash($_SERVER['HTTP_X_FORWARDED_FOR']);
            $parts = explode(',', $xff);
            $first = isset($parts[0]) ? trim($parts[0]) : '';
            if ($first !== '') {
                return sanitize_text_field($first);
            }
        }
        if (!empty($_SERVER['REMOTE_ADDR'])) {
            return sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR']));
        }
        return '';
    }

    /**
     * Absolute URL for the first-party proxy endpoint. Passed into the pixel
     * via `window.adrayPixelConfig.proxyEndpoint` so the pixel knows to POST
     * same-origin instead of hitting adray.ai directly.
     */
    private static function get_proxy_endpoint_url() {
        return esc_url_raw(rest_url(self::PROXY_REST_NAMESPACE . self::PROXY_REST_ROUTE));
    }

    /**
     * Phase B — server-side attribution capture.
     *
     * Reads UTMs and click IDs from $_GET on every request (via the `init`
     * hook, before any theme/JS output). Persists:
     *   - First touch (cookie _adray_srv_first): written once and kept for
     *     ATTRIB_COOKIE_MAX_DAYS. Never overwritten while the cookie lives.
     *   - Last touch (cookie _adray_srv_last): overwritten on every request
     *     that carries attribution signals.
     *
     * This path is invisible to ad-blockers because it never surfaces in the
     * browser's network tab — the attribution is already server-side by the
     * time the page renders.
     */
    public static function capture_server_side_attribution() {
        // Skip admin, cron, and REST requests — only interested in front-end.
        if (is_admin() || (defined('DOING_CRON') && DOING_CRON) || (defined('DOING_AJAX') && DOING_AJAX)) {
            return;
        }
        if (defined('REST_REQUEST') && REST_REQUEST) {
            return;
        }

        // Already sent? Can't write cookies then.
        if (headers_sent()) {
            return;
        }

        $snapshot = self::extract_attribution_snapshot_from_request();
        if (empty($snapshot)) {
            // No attribution signals on this request — nothing to update.
            return;
        }

        $now_iso = gmdate('c');
        $snapshot['captured_at'] = $now_iso;
        $snapshot['landing_url'] = self::current_request_url();
        $referrer = isset($_SERVER['HTTP_REFERER']) ? esc_url_raw(wp_unslash($_SERVER['HTTP_REFERER'])) : '';
        if ($referrer !== '') {
            $snapshot['referrer'] = $referrer;
        }

        // Last touch: always overwrite.
        self::write_attribution_cookie(self::ATTRIB_LAST_COOKIE, $snapshot);

        // First touch: write only if absent.
        if (empty($_COOKIE[self::ATTRIB_FIRST_COOKIE])) {
            self::write_attribution_cookie(self::ATTRIB_FIRST_COOKIE, $snapshot);
        }
    }

    private static function extract_attribution_snapshot_from_request() {
        $snapshot = array();
        foreach (self::ATTRIB_TRACKED_PARAMS as $param) {
            if (isset($_GET[$param])) {
                $value = sanitize_text_field(wp_unslash($_GET[$param]));
                if ($value !== '') {
                    // Cap individual values to keep the cookie small.
                    $snapshot[$param] = substr($value, 0, 300);
                }
            }
        }
        return $snapshot;
    }

    private static function current_request_url() {
        $scheme = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https' : 'http';
        $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : '';
        $uri = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
        if (!$host) {
            return '';
        }
        return esc_url_raw($scheme . '://' . $host . $uri);
    }

    private static function write_attribution_cookie($name, array $data) {
        // JSON → base64 keeps cookie value ASCII-safe for intermediaries.
        $encoded = base64_encode(wp_json_encode($data));
        // Cookies have a ~4KB limit — cap at 1500 chars of base64.
        if (strlen($encoded) > 1500) {
            return;
        }
        $expires = time() + (self::ATTRIB_COOKIE_MAX_DAYS * DAY_IN_SECONDS);
        $secure = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on');
        // HTTP-only so the browser can't read it (but the server always can).
        setcookie($name, $encoded, array(
            'expires'  => $expires,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ));
        // Mirror into $_COOKIE so downstream reads within the same request see it.
        $_COOKIE[$name] = $encoded;
    }

    public static function read_attribution_cookie($name) {
        if (empty($_COOKIE[$name])) {
            return null;
        }
        $raw = (string) $_COOKIE[$name];
        $decoded = base64_decode($raw, true);
        if ($decoded === false) {
            return null;
        }
        $data = json_decode($decoded, true);
        return is_array($data) ? $data : null;
    }

    /**
     * Build the server-side attribution snapshot to be attached to webhooks.
     * Prefers order meta (if the order persisted it at checkout time), then
     * falls back to the live cookies from the current request.
     */
    public static function build_server_attribution_snapshot($order = null) {
        $first = null;
        $last = null;

        if ($order && is_object($order) && method_exists($order, 'get_meta')) {
            $meta_first = $order->get_meta('_adray_srv_first', true);
            $meta_last = $order->get_meta('_adray_srv_last', true);
            if (is_string($meta_first) && $meta_first !== '') {
                $decoded_first = json_decode($meta_first, true);
                if (is_array($decoded_first)) {
                    $first = $decoded_first;
                }
            }
            if (is_string($meta_last) && $meta_last !== '') {
                $decoded_last = json_decode($meta_last, true);
                if (is_array($decoded_last)) {
                    $last = $decoded_last;
                }
            }
        }

        if ($first === null) {
            $first = self::read_attribution_cookie(self::ATTRIB_FIRST_COOKIE);
        }
        if ($last === null) {
            $last = self::read_attribution_cookie(self::ATTRIB_LAST_COOKIE);
        }

        if (!$first && !$last) {
            return null;
        }

        return array(
            'source' => 'server_side',
            'captured_by' => 'wordpress_plugin_' . self::VERSION,
            'first_touch' => $first ?: null,
            'last_touch' => $last ?: null,
        );
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
            // Phase B: persist the server-side attribution snapshot onto the
            // order so the webhook has access to it even if the customer's
            // cookies rotate before the async order_sync runs.
            $first = self::read_attribution_cookie(self::ATTRIB_FIRST_COOKIE);
            $last = self::read_attribution_cookie(self::ATTRIB_LAST_COOKIE);
            if (is_array($first)) {
                $order->update_meta_data('_adray_srv_first', wp_json_encode($first));
            }
            if (is_array($last)) {
                $order->update_meta_data('_adray_srv_last', wp_json_encode($last));
            }
            $order->save();
        }
    }

    public static function track_wp_login_event($user_login, $user) {
        if (!$user || !($user instanceof WP_User)) {
            return;
        }

        // Skip admin/editor logins; track all other user roles (customer, subscriber, etc)
        $roles = is_array($user->roles) ? $user->roles : array();
        $exclude_roles = array('administrator', 'editor');
        $has_excluded_role = false;
        foreach ($exclude_roles as $excluded) {
            if (in_array($excluded, $roles, true)) {
                $has_excluded_role = true;
                break;
            }
        }
        if ($has_excluded_role) {
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

        // Skip admin/editor logouts; track all other user roles
        $roles = is_array($user->roles) ? $user->roles : array();
        $exclude_roles = array('administrator', 'editor');
        $has_excluded_role = false;
        foreach ($exclude_roles as $excluded) {
            if (in_array($excluded, $roles, true)) {
                $has_excluded_role = true;
                break;
            }
        }
        if ($has_excluded_role) {
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

    public static function backfill_recent_orders($page = 1) {
        if (!function_exists('wc_get_orders')) {
            return;
        }

        $done_marker = get_option(self::OPTION_BACKFILL_DONE, '');
        $target_marker = self::get_backfill_marker();
        if ($done_marker === $target_marker) {
            return;
        }

        $days = self::get_backfill_days();
        $created_after = null;
        if ($days > 0) {
            $created_after = gmdate('Y-m-d H:i:s', time() - ($days * DAY_IN_SECONDS));
        }

        $all_statuses = function_exists('wc_get_order_statuses')
            ? array_map(function ($status_key) {
                return preg_replace('/^wc-/', '', (string) $status_key);
            }, array_keys(wc_get_order_statuses()))
            : array('pending', 'processing', 'completed', 'on-hold', 'refunded', 'cancelled', 'failed');

        $per_page = 50; // Safer chunk to prevent PHP timeout on large instances

        $start_time = time();
        $max_execution_time = ini_get('max_execution_time') ? (int) ini_get('max_execution_time') : 30;
        if ($max_execution_time <= 0) {
            $max_execution_time = 60;
        }
        $time_limit = max(5, $max_execution_time - 15);

        while (true) {
            $query_args = array(
                'limit' => $per_page,
                'paged' => $page,
                'orderby' => 'date',
                'order' => 'DESC',
                'status' => $all_statuses,
                'return' => 'ids',
            );

            if ($created_after) {
                $query_args['date_created'] = '>=' . $created_after;
            }

            $orders = wc_get_orders($query_args);

            if (empty($orders)) {
                update_option(self::OPTION_BACKFILL_DONE, $target_marker, false);
                return;
            }

            foreach ($orders as $order_id) {
                self::sync_woo_order_to_backend($order_id);
            }

            if (count($orders) < $per_page) {
                update_option(self::OPTION_BACKFILL_DONE, $target_marker, false);
                return;
            }
            
            if (time() - $start_time >= $time_limit) {
                // Schedule next page if we're running out of time in the current PHP execution
                wp_schedule_single_event(time() + 5, 'adnova_pixel_backfill_orders', array($page + 1));
                return;
            }
            $page++;
        }
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
            // Phase B: server-side attribution captured in `init` hook — ad-blocker proof.
            'server_attribution_snapshot' => self::build_server_attribution_snapshot($order),
        );

        // Use non-blocking to avoid WordPress hanging if backend is slow/unresponsive
        $response = wp_remote_post(
            self::DEFAULT_ORDER_SYNC_URL,
            array(
                'timeout'  => 4,
                'blocking' => false,
                'headers'  => array(
                    'Content-Type' => 'application/json',
                ),
                'body'     => wp_json_encode($payload),
                'sslverify' => false,
            )
        );

        // Since we're non-blocking, response is likely null/empty — logging would be silent anyway
        // Failures will be captured server-side and visible in Render logs
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

    // ── Admin settings page ───────────────────────────────────────────

    /**
     * Handles the "Force Backfill Now" button from admin settings.
     * Runs directly (no WP-Cron dependency) so it works even on hosts
     * with DISABLE_WP_CRON or no frontend traffic to trigger cron.
     */
    public static function handle_admin_run_backfill() {
        if (!current_user_can('manage_options')) {
            wp_die('Sin permisos');
        }
        if (!check_admin_referer('adnova_run_backfill')) {
            wp_die('Nonce inválido');
        }

        // Reset so backfill runs fresh regardless of previous state.
        delete_option(self::OPTION_BACKFILL_DONE);
        wp_clear_scheduled_hook('adnova_pixel_backfill_orders');

        // Increase PHP execution time for this admin request.
        if (function_exists('set_time_limit')) {
            @set_time_limit(300);
        }

        // Run directly — bypasses WP-Cron entirely.
        self::backfill_recent_orders(1);

        // If the function hit its internal time limit it will have scheduled
        // the next page via WP-Cron. Spawn cron now so it fires immediately
        // without waiting for a frontend visit.
        if (function_exists('spawn_cron')) {
            spawn_cron();
        }

        wp_safe_redirect(add_query_arg(
            array('page' => 'adnova-pixel-settings', 'adnova_backfill_ok' => '1'),
            admin_url('options-general.php')
        ));
        exit;
    }

    public static function register_admin_menu() {
        add_options_page(
            'Adray Pixel',
            'Adray Pixel',
            'manage_options',
            'adnova-pixel-settings',
            array(__CLASS__, 'render_settings_page')
        );
    }

    public static function register_settings() {
        register_setting('adnova_pixel_settings_group', self::OPTION_CLARITY_ID, array(
            'type'              => 'string',
            'sanitize_callback' => 'sanitize_text_field',
            'default'           => '',
        ));
        register_setting('adnova_pixel_settings_group', self::OPTION_SCRIPT_URL, array(
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => self::DEFAULT_SCRIPT_URL,
        ));
    }

    public static function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $clarity_id = get_option(self::OPTION_CLARITY_ID, '');
        $script_url = get_option(self::OPTION_SCRIPT_URL, self::DEFAULT_SCRIPT_URL);
        $backfill_done  = get_option(self::OPTION_BACKFILL_DONE, '');
        $backfill_target = self::get_backfill_marker();
        $backfill_ok = isset($_GET['adnova_backfill_ok']);
        ?>
        <div class="wrap">
            <h1>Adray Pixel — Configuración</h1>

            <?php if ($backfill_ok): ?>
            <div class="notice notice-success is-dismissible">
                <p><strong>Backfill iniciado.</strong> Los pedidos históricos se están sincronizando con AdRay. Refresca la dashboard de producción en 60 segundos.</p>
            </div>
            <?php endif; ?>

            <form method="post" action="options.php">
                <?php settings_fields('adnova_pixel_settings_group'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">
                            <label for="<?php echo esc_attr(self::OPTION_CLARITY_ID); ?>">
                                Microsoft Clarity ID
                            </label>
                        </th>
                        <td>
                            <input
                                type="text"
                                id="<?php echo esc_attr(self::OPTION_CLARITY_ID); ?>"
                                name="<?php echo esc_attr(self::OPTION_CLARITY_ID); ?>"
                                value="<?php echo esc_attr($clarity_id); ?>"
                                class="regular-text"
                                placeholder="ej. wbbp6xsuyd"
                            />
                            <p class="description">
                                ID del proyecto de <a href="https://clarity.microsoft.com" target="_blank">Microsoft Clarity</a>.
                                Déjalo vacío para desactivar la grabación de sesiones.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">
                            <label for="<?php echo esc_attr(self::OPTION_SCRIPT_URL); ?>">
                                URL del Pixel
                            </label>
                        </th>
                        <td>
                            <input
                                type="url"
                                id="<?php echo esc_attr(self::OPTION_SCRIPT_URL); ?>"
                                name="<?php echo esc_attr(self::OPTION_SCRIPT_URL); ?>"
                                value="<?php echo esc_attr($script_url); ?>"
                                class="large-text"
                            />
                            <p class="description">No cambiar salvo instrucción de Adray.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Guardar cambios'); ?>
            </form>

            <hr/>
            <h2>Estado</h2>
            <ul>
                <li><strong>Site ID:</strong> <?php echo esc_html(self::get_site_id()); ?></li>
                <li><strong>Clarity ID:</strong> <?php echo $clarity_id ? esc_html($clarity_id) : '<em>No configurado</em>'; ?></li>
                <li><strong>Pixel URL:</strong> <?php echo esc_html($script_url); ?></li>
                <li><strong>Versión:</strong> <?php echo esc_html(self::VERSION); ?></li>
                <li>
                    <strong>Backfill histórico:</strong>
                    <?php if ($backfill_done === $backfill_target): ?>
                        <span style="color:green;">✓ Completado (<code><?php echo esc_html($backfill_done); ?></code>)</span>
                    <?php else: ?>
                        <span style="color:orange;">⏳ Pendiente</span>
                        <?php if ($backfill_done): ?>
                            — último run: <code><?php echo esc_html($backfill_done); ?></code>
                        <?php endif; ?>
                    <?php endif; ?>
                </li>
            </ul>

            <hr/>
            <h2>Sincronización de pedidos históricos</h2>
            <p>Sincroniza los últimos <?php echo esc_html(self::get_backfill_days() > 0 ? self::get_backfill_days() . ' días' : 'todos'); ?> de pedidos de WooCommerce con AdRay de forma inmediata, sin depender de WP-Cron.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="adnova_run_backfill">
                <?php wp_nonce_field('adnova_run_backfill'); ?>
                <?php submit_button('Forzar Backfill Ahora', 'secondary', 'submit', false); ?>
            </form>
        </div>
        <?php
    }
}

Adnova_Pixel_Plugin::init();
