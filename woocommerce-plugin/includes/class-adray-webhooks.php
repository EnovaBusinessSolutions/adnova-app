<?php
/**
 * ADRAY Webhooks Management Class
 * 
 * Manages WooCommerce webhooks for sending data to ADRAY
 */

if (!defined('ABSPATH')) {
    exit;
}

class ADRAY_Webhooks {

    private static $instance = null;

    /**
     * All webhook topics we register for comprehensive marketing audit data
     */
    private $webhook_topics = array(
        // Orders - Critical for revenue and purchase behavior analysis
        'order.created' => 'Nueva orden creada',
        'order.updated' => 'Orden actualizada',
        'order.deleted' => 'Orden eliminada',
        'order.restored' => 'Orden restaurada',
        
        // Products - Essential for catalog and inventory analysis
        'product.created' => 'Nuevo producto',
        'product.updated' => 'Producto actualizado',
        'product.deleted' => 'Producto eliminado',
        'product.restored' => 'Producto restaurado',
        
        // Customers - Important for customer lifetime value and segmentation
        'customer.created' => 'Nuevo cliente',
        'customer.updated' => 'Cliente actualizado',
        'customer.deleted' => 'Cliente eliminado',
        
        // Coupons - Marketing campaign tracking
        'coupon.created' => 'Nuevo cupón',
        'coupon.updated' => 'Cupón actualizado',
        'coupon.deleted' => 'Cupón eliminado',
    );

    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        // Hook into action topic delivery if needed for custom processing
        add_filter('woocommerce_webhook_http_args', array($this, 'add_auth_header'), 10, 3);
    }

    /**
     * Get all available webhook topics
     */
    public function get_topics() {
        return $this->webhook_topics;
    }

    /**
     * Add authorization header to webhook deliveries
     */
    public function add_auth_header($http_args, $arg, $webhook_id) {
        // Check if this is one of our webhooks
        $our_webhook_ids = get_option('adray_webhook_ids', array());
        
        if (in_array($webhook_id, $our_webhook_ids)) {
            $token = get_option('adray_access_token');
            if ($token) {
                $http_args['headers']['Authorization'] = 'Bearer ' . $token;
                $http_args['headers']['X-ADRAY-Plugin-Version'] = ADRAY_WOO_VERSION;
            }
        }
        
        return $http_args;
    }

    /**
     * Create all webhooks
     */
    public function create_all_webhooks() {
        $token = get_option('adray_access_token');
        $server_url = get_option('adray_server_url', ADRAY_WOO_DEFAULT_SERVER);
        
        if (!$token || !$server_url) {
            return array(
                'ok' => false,
                'error' => 'Not connected to ADRAY'
            );
        }

        $delivery_url = rtrim($server_url, '/') . '/api/woocommerce/webhook';
        $created_ids = array();
        $errors = array();

        foreach ($this->webhook_topics as $topic => $description) {
            $result = $this->create_webhook($topic, $description, $delivery_url);
            
            if ($result['ok']) {
                $created_ids[] = $result['id'];
            } else {
                $errors[] = $topic . ': ' . $result['error'];
            }
        }

        // Save webhook IDs
        update_option('adray_webhook_ids', $created_ids);

        if (!empty($errors)) {
            return array(
                'ok' => false,
                'error' => implode(', ', $errors),
                'created' => count($created_ids)
            );
        }

        return array(
            'ok' => true,
            'created' => count($created_ids)
        );
    }

    /**
     * Create a single webhook
     */
    private function create_webhook($topic, $description, $delivery_url) {
        // Check if webhook already exists
        $existing = $this->find_webhook_by_topic($topic);
        if ($existing) {
            // Update existing webhook
            $existing->set_delivery_url($delivery_url);
            $existing->set_status('active');
            $existing->save();
            
            return array(
                'ok' => true,
                'id' => $existing->get_id()
            );
        }

        // Create new webhook
        $webhook = new WC_Webhook();
        $webhook->set_name('ADRAY: ' . $description);
        $webhook->set_topic($topic);
        $webhook->set_delivery_url($delivery_url);
        $webhook->set_status('active');
        $webhook->set_user_id(get_current_user_id() ?: 1);
        $webhook->set_api_version('wp_api_v3');
        
        // Custom headers for auth (backup method)
        $token = get_option('adray_access_token');
        
        try {
            $webhook->save();
            return array(
                'ok' => true,
                'id' => $webhook->get_id()
            );
        } catch (Exception $e) {
            return array(
                'ok' => false,
                'error' => $e->getMessage()
            );
        }
    }

    /**
     * Find webhook by topic
     */
    private function find_webhook_by_topic($topic) {
        $our_webhook_ids = get_option('adray_webhook_ids', array());
        
        foreach ($our_webhook_ids as $id) {
            try {
                $webhook = wc_get_webhook($id);
                if ($webhook && $webhook->get_topic() === $topic) {
                    return $webhook;
                }
            } catch (Exception $e) {
                continue;
            }
        }
        
        return null;
    }

    /**
     * Delete all ADRAY webhooks
     */
    public function delete_all_webhooks() {
        $webhook_ids = get_option('adray_webhook_ids', array());
        
        foreach ($webhook_ids as $id) {
            try {
                $webhook = wc_get_webhook($id);
                if ($webhook) {
                    $webhook->delete(true);
                }
            } catch (Exception $e) {
                // Continue deleting other webhooks
                continue;
            }
        }
        
        delete_option('adray_webhook_ids');
        
        return array('ok' => true);
    }

    /**
     * Get status of all webhooks
     */
    public function get_status() {
        $webhook_ids = get_option('adray_webhook_ids', array());
        $status = array();
        
        foreach ($this->webhook_topics as $topic => $description) {
            $found = false;
            $active = false;
            
            foreach ($webhook_ids as $id) {
                try {
                    $webhook = wc_get_webhook($id);
                    if ($webhook && $webhook->get_topic() === $topic) {
                        $found = true;
                        $active = $webhook->get_status() === 'active';
                        break;
                    }
                } catch (Exception $e) {
                    continue;
                }
            }
            
            $status[$topic] = array(
                'description' => $description,
                'registered' => $found,
                'active' => $active
            );
        }
        
        return $status;
    }

    /**
     * Count active webhooks
     */
    public function count_active() {
        $status = $this->get_status();
        $count = 0;
        
        foreach ($status as $topic => $info) {
            if ($info['active']) {
                $count++;
            }
        }
        
        return $count;
    }
}
