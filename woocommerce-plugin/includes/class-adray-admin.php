<?php
/**
 * ADRAY Admin Settings Page
 * 
 * Handles the WordPress admin UI for ADRAY settings
 */

if (!defined('ABSPATH')) {
    exit;
}

class ADRAY_Admin {

    private static $instance = null;

    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action('admin_menu', array($this, 'add_menu'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_assets'));
        add_action('wp_ajax_adray_health_check', array($this, 'ajax_health_check'));
        add_action('wp_ajax_adray_connect', array($this, 'ajax_connect'));
        add_action('wp_ajax_adray_disconnect', array($this, 'ajax_disconnect'));
        add_action('admin_init', array($this, 'register_settings'));
    }

    /**
     * Add menu under WooCommerce
     */
    public function add_menu() {
        add_submenu_page(
            'woocommerce',
            'ADRAY - Configuración',
            'ADRAY',
            'manage_woocommerce',
            'adray-settings',
            array($this, 'render_settings_page')
        );
    }

    /**
     * Register settings
     */
    public function register_settings() {
        register_setting('adray_settings', 'adray_server_url', array(
            'type' => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default' => ADRAY_WOO_DEFAULT_SERVER
        ));
    }

    /**
     * Enqueue admin assets
     */
    public function enqueue_assets($hook) {
        if ('woocommerce_page_adray-settings' !== $hook) {
            return;
        }

        wp_enqueue_style(
            'adray-admin',
            ADRAY_WOO_PLUGIN_URL . 'assets/css/admin.css',
            array(),
            ADRAY_WOO_VERSION
        );

        wp_enqueue_script(
            'adray-admin',
            ADRAY_WOO_PLUGIN_URL . 'assets/js/admin.js',
            array('jquery'),
            ADRAY_WOO_VERSION,
            true
        );

        wp_localize_script('adray-admin', 'adrayAdmin', array(
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('adray_admin_nonce'),
            'strings' => array(
                'connecting' => __('Conectando...', 'adray-woocommerce'),
                'disconnecting' => __('Desconectando...', 'adray-woocommerce'),
                'checking' => __('Verificando...', 'adray-woocommerce'),
                'error' => __('Error', 'adray-woocommerce'),
                'success' => __('Éxito', 'adray-woocommerce')
            )
        ));
    }

    /**
     * Render settings page
     */
    public function render_settings_page() {
        $api = ADRAY_API::get_instance();
        $webhooks = ADRAY_Webhooks::get_instance();
        
        $is_connected = $api->is_connected();
        $server_url = get_option('adray_server_url', ADRAY_WOO_DEFAULT_SERVER);
        $connected_at = get_option('adray_connected_at', '');
        $webhook_status = $is_connected ? $webhooks->get_status() : array();
        $active_webhooks = $is_connected ? $webhooks->count_active() : 0;
        $total_webhooks = count($webhooks->get_topics());
        
        ?>
        <div class="wrap adray-wrap">
            <div class="adray-header">
                <h1 class="adray-title">
                    <span class="adray-logo">ADRAY</span>
                    <span class="adray-subtitle">para WooCommerce</span>
                </h1>
                <p class="adray-description">
                    Conecta tu tienda con ADRAY AI para recibir auditorías de marketing automatizadas y análisis de rendimiento.
                </p>
            </div>

            <div class="adray-content">
                <!-- Connection Status Card -->
                <div class="adray-card">
                    <div class="adray-card-header">
                        <h2>Estado de Conexión</h2>
                    </div>
                    <div class="adray-card-body">
                        <div class="adray-status <?php echo $is_connected ? 'connected' : 'disconnected'; ?>">
                            <span class="adray-status-dot"></span>
                            <span class="adray-status-text">
                                <?php echo $is_connected ? 'Conectado' : 'No conectado'; ?>
                            </span>
                            <?php if ($is_connected && $connected_at): ?>
                                <span class="adray-status-since">
                                    desde <?php echo esc_html(date_i18n('d M Y, H:i', strtotime($connected_at))); ?>
                                </span>
                            <?php endif; ?>
                        </div>

                        <?php if ($is_connected): ?>
                            <div class="adray-webhooks-summary">
                                <span class="dashicons dashicons-update"></span>
                                <?php echo esc_html($active_webhooks); ?> de <?php echo esc_html($total_webhooks); ?> webhooks activos
                            </div>
                        <?php endif; ?>

                        <div id="adray-message" class="adray-message" style="display: none;"></div>
                    </div>
                </div>

                <!-- Server Configuration Card -->
                <div class="adray-card">
                    <div class="adray-card-header">
                        <h2>Configuración del Servidor</h2>
                    </div>
                    <div class="adray-card-body">
                        <form id="adray-settings-form">
                            <table class="form-table">
                                <tr>
                                    <th scope="row">
                                        <label for="adray_server_url">URL del Servidor ADRAY</label>
                                    </th>
                                    <td>
                                        <input type="url" 
                                               id="adray_server_url" 
                                               name="adray_server_url"
                                               class="regular-text"
                                               value="<?php echo esc_attr($server_url); ?>"
                                               placeholder="https://adray.ai"
                                               <?php echo $is_connected ? 'disabled' : ''; ?>
                                        />
                                        <p class="description">
                                            URL del servidor ADRAY. Por defecto: https://adray.ai
                                        </p>
                                    </td>
                                </tr>
                                <?php if (!$is_connected): ?>
                                <tr>
                                    <th scope="row">
                                        <label for="adray_connection_code">Código de Conexión</label>
                                    </th>
                                    <td>
                                        <input type="text" 
                                               id="adray_connection_code" 
                                               name="adray_connection_code"
                                               class="regular-text"
                                               value=""
                                               placeholder="Ej: ABC123"
                                               style="text-transform: uppercase; letter-spacing: 2px; font-family: monospace;"
                                               maxlength="6"
                                        />
                                        <p class="description">
                                            Ingresa el código de 6 caracteres que obtuviste en el panel de ADRAY.<br>
                                            <a href="https://adray.ai/dashboard" target="_blank">Obtener código desde el dashboard →</a>
                                        </p>
                                    </td>
                                </tr>
                                <?php endif; ?>
                            </table>

                            <div class="adray-actions">
                                <?php if (!$is_connected): ?>
                                    <button type="button" id="adray-health-check" class="button button-secondary">
                                        <span class="dashicons dashicons-heart"></span>
                                        Verificar Conexión
                                    </button>
                                    <button type="button" id="adray-connect" class="button button-primary">
                                        <span class="dashicons dashicons-admin-links"></span>
                                        Conectar Tienda
                                    </button>
                                <?php else: ?>
                                    <button type="button" id="adray-disconnect" class="button button-secondary adray-btn-danger">
                                        <span class="dashicons dashicons-dismiss"></span>
                                        Desconectar
                                    </button>
                                <?php endif; ?>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- Webhooks Status Card (only when connected) -->
                <?php if ($is_connected): ?>
                <div class="adray-card">
                    <div class="adray-card-header">
                        <h2>Webhooks Registrados</h2>
                    </div>
                    <div class="adray-card-body">
                        <p class="adray-info">
                            Los siguientes eventos se envían automáticamente a ADRAY para análisis:
                        </p>
                        <div class="adray-webhooks-grid">
                            <?php foreach ($webhook_status as $topic => $info): ?>
                            <div class="adray-webhook-item <?php echo $info['active'] ? 'active' : 'inactive'; ?>">
                                <span class="adray-webhook-dot"></span>
                                <span class="adray-webhook-topic"><?php echo esc_html($topic); ?></span>
                                <span class="adray-webhook-desc"><?php echo esc_html($info['description']); ?></span>
                            </div>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
                <?php endif; ?>

                <!-- Help Card -->
                <div class="adray-card adray-card-help">
                    <div class="adray-card-header">
                        <h2>¿Necesitas Ayuda?</h2>
                    </div>
                    <div class="adray-card-body">
                        <p>
                            Visita nuestra <a href="https://adray.ai/support" target="_blank">página de soporte</a> 
                            o contacta con nosotros en <a href="mailto:soporte@adray.ai">soporte@adray.ai</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    /**
     * AJAX: Health check
     */
    public function ajax_health_check() {
        check_ajax_referer('adray_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(array('message' => 'Unauthorized'));
        }

        // Update server URL if provided
        if (isset($_POST['server_url'])) {
            update_option('adray_server_url', esc_url_raw($_POST['server_url']));
        }

        $api = ADRAY_API::get_instance();
        $result = $api->health_check();

        if ($result['ok']) {
            wp_send_json_success(array(
                'message' => 'Servidor disponible',
                'time' => $result['time']
            ));
        } else {
            wp_send_json_error(array(
                'message' => $result['error'] ?? 'No se pudo conectar al servidor'
            ));
        }
    }

    /**
     * AJAX: Connect to ADRAY
     */
    public function ajax_connect() {
        check_ajax_referer('adray_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(array('message' => 'Unauthorized'));
        }

        // Update server URL if provided
        if (isset($_POST['server_url'])) {
            update_option('adray_server_url', esc_url_raw($_POST['server_url']));
        }

        // Get connection code
        $connection_code = isset($_POST['connection_code']) ? sanitize_text_field($_POST['connection_code']) : '';

        $api = ADRAY_API::get_instance();
        $result = $api->install($connection_code);

        if (!$result['ok']) {
            wp_send_json_error(array(
                'message' => $result['error'] ?? 'Error al conectar'
            ));
        }

        // Create webhooks
        $webhooks = ADRAY_Webhooks::get_instance();
        $webhook_result = $webhooks->create_all_webhooks();

        $message = '¡Conectado exitosamente!';
        if (!empty($result['userLinked'])) {
            $message .= ' Tu tienda está vinculada a tu cuenta ADRAY.';
        } else {
            $message .= ' (Sin código de vinculación)';
        }

        wp_send_json_success(array(
            'message' => $message,
            'webhooks_created' => $webhook_result['created'] ?? 0,
            'userLinked' => !empty($result['userLinked'])
        ));
    }

    /**
     * AJAX: Disconnect from ADRAY
     */
    public function ajax_disconnect() {
        check_ajax_referer('adray_admin_nonce', 'nonce');
        
        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(array('message' => 'Unauthorized'));
        }

        // Delete webhooks first
        $webhooks = ADRAY_Webhooks::get_instance();
        $webhooks->delete_all_webhooks();

        // Then disconnect from server
        $api = ADRAY_API::get_instance();
        $api->uninstall();

        wp_send_json_success(array(
            'message' => 'Desconectado correctamente'
        ));
    }
}
