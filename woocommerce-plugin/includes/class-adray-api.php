<?php
/**
 * ADRAY API Communication Class
 * 
 * Handles all communication with the ADRAY server
 */

if (!defined('ABSPATH')) {
    exit;
}

class ADRAY_API {

    private static $instance = null;

    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Constructor
    }

    /**
     * Get the server URL
     */
    public function get_server_url() {
        return rtrim(get_option('adray_server_url', ADRAY_WOO_DEFAULT_SERVER), '/');
    }

    /**
     * Get the access token
     */
    public function get_token() {
        return get_option('adray_access_token', '');
    }

    /**
     * Check if connected
     */
    public function is_connected() {
        return !empty($this->get_token());
    }

    /**
     * Health check - test server connectivity
     */
    public function health_check() {
        $response = wp_remote_get(
            $this->get_server_url() . '/api/woocommerce/healthz',
            array(
                'timeout' => 10,
                'headers' => array(
                    'Content-Type' => 'application/json'
                )
            )
        );

        if (is_wp_error($response)) {
            return array(
                'ok' => false,
                'error' => $response->get_error_message()
            );
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $code = wp_remote_retrieve_response_code($response);

        if ($code !== 200 || empty($body['ok'])) {
            return array(
                'ok' => false,
                'error' => $body['error'] ?? 'Unknown error'
            );
        }

        return array(
            'ok' => true,
            'time' => $body['time'] ?? null
        );
    }

    /**
     * Install/Connect to ADRAY server
     * 
     * @param string $connection_code Optional connection code from ADRAY dashboard
     */
    public function install($connection_code = '') {
        $shop_domain = $this->get_shop_domain();
        $admin_email = get_option('admin_email');

        $body = array(
            'shopDomain' => $shop_domain,
            'adminEmail' => $admin_email,
            'pluginVersion' => ADRAY_WOO_VERSION
        );

        // Add connection code if provided
        if (!empty($connection_code)) {
            $body['connectionCode'] = strtoupper(trim($connection_code));
        }

        $response = wp_remote_post(
            $this->get_server_url() . '/api/woocommerce/install',
            array(
                'timeout' => 15,
                'headers' => array(
                    'Content-Type' => 'application/json'
                ),
                'body' => wp_json_encode($body)
            )
        );

        if (is_wp_error($response)) {
            return array(
                'ok' => false,
                'error' => $response->get_error_message()
            );
        }

        $body = json_decode(wp_remote_retrieve_body($response), true);
        $code = wp_remote_retrieve_response_code($response);

        if ($code !== 200 || empty($body['ok']) || empty($body['token'])) {
            return array(
                'ok' => false,
                'error' => $body['error'] ?? 'Failed to connect'
            );
        }

        // Save the token
        update_option('adray_access_token', $body['token']);
        update_option('adray_connected', true);
        update_option('adray_connected_at', current_time('mysql'));
        update_option('adray_user_linked', !empty($body['userLinked']));

        return array(
            'ok' => true,
            'token' => $body['token'],
            'userLinked' => !empty($body['userLinked'])
        );
    }


    /**
     * Uninstall/Disconnect from ADRAY server
     */
    public function uninstall() {
        $token = $this->get_token();
        
        if (!$token) {
            return array('ok' => true);
        }

        $response = wp_remote_request(
            $this->get_server_url() . '/api/woocommerce/install',
            array(
                'method' => 'DELETE',
                'timeout' => 10,
                'headers' => array(
                    'Authorization' => 'Bearer ' . $token,
                    'Content-Type' => 'application/json'
                )
            )
        );

        // Clear local options regardless of response
        delete_option('adray_access_token');
        delete_option('adray_connected');
        delete_option('adray_connected_at');

        if (is_wp_error($response)) {
            return array(
                'ok' => false,
                'error' => $response->get_error_message()
            );
        }

        return array('ok' => true);
    }

    /**
     * Get the shop domain
     */
    private function get_shop_domain() {
        $site_url = get_site_url();
        $parsed = parse_url($site_url);
        return $parsed['host'] ?? $site_url;
    }
}
