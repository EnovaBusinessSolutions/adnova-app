/**
 * WooCommerce Test Page JavaScript
 * External file to comply with CSP
 */

const WEBHOOK_TOPICS = [
    { topic: 'order.created', desc: 'Nueva orden creada' },
    { topic: 'order.updated', desc: 'Orden actualizada' },
    { topic: 'order.deleted', desc: 'Orden eliminada' },
    { topic: 'order.restored', desc: 'Orden restaurada' },
    { topic: 'product.created', desc: 'Nuevo producto' },
    { topic: 'product.updated', desc: 'Producto actualizado' },
    { topic: 'product.deleted', desc: 'Producto eliminado' },
    { topic: 'product.restored', desc: 'Producto restaurado' },
    { topic: 'customer.created', desc: 'Nuevo cliente' },
    { topic: 'customer.updated', desc: 'Cliente actualizado' },
    { topic: 'customer.deleted', desc: 'Cliente eliminado' },
    { topic: 'coupon.created', desc: 'Nuevo cupón' },
    { topic: 'coupon.updated', desc: 'Cupón actualizado' },
    { topic: 'coupon.deleted', desc: 'Cupón eliminado' },
];

// State
let state = {
    connected: false,
    token: null,
    serverUrl: ''
};

// Elements
const $ = id => document.getElementById(id);

// Logging
function log(msg, type = 'info') {
    const logBox = $('logBox');
    const time = new Date().toLocaleTimeString('es-MX');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${msg}</span>`;
    logBox.insertBefore(entry, logBox.firstChild);
}

// Status helpers
function showStatus(el, msg, type) {
    el.textContent = msg;
    el.className = `status-box show ${type}`;
}

function hideStatus(el) {
    el.className = 'status-box';
}

function updateConnectionUI() {
    const statusDot = $('statusDot');
    const statusText = $('statusText');
    const btnConnect = $('btnConnect');
    const btnDisconnect = $('btnDisconnect');
    const tokenDisplay = $('tokenDisplay');
    const accessToken = $('accessToken');
    const btnTestOrder = $('btnTestOrder');
    const btnTestProduct = $('btnTestProduct');
    const btnTestCustomer = $('btnTestCustomer');

    if (state.connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Conectado';
        btnConnect.classList.add('hidden');
        btnDisconnect.classList.remove('hidden');
        tokenDisplay.classList.remove('hidden');
        accessToken.value = state.token || '';
        btnTestOrder.disabled = false;
        btnTestProduct.disabled = false;
        btnTestCustomer.disabled = false;
    } else {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'No conectado';
        btnConnect.classList.remove('hidden');
        btnDisconnect.classList.add('hidden');
        tokenDisplay.classList.add('hidden');
        accessToken.value = '';
        btnTestOrder.disabled = true;
        btnTestProduct.disabled = true;
        btnTestCustomer.disabled = true;
    }
    renderWebhooks();
}

function renderWebhooks() {
    const webhookList = $('webhookList');
    webhookList.innerHTML = WEBHOOK_TOPICS.map(w => `
        <div class="webhook-item">
            <span class="topic">${w.topic}</span>
            <span style="color: var(--text-muted); font-size: 0.8rem;">${w.desc}</span>
            <span class="status ${state.connected ? 'active' : 'pending'}">${state.connected ? 'Activo' : 'Pendiente'}</span>
        </div>
    `).join('');
}

// Get current server URL
function getServerUrl() {
    return window.location.origin;
}

// API calls
async function healthCheck() {
    const url = getServerUrl();
    const healthStatus = $('healthStatus');

    log(`Health check: ${url}/api/woocommerce/healthz`);

    try {
        const res = await fetch(`${url}/api/woocommerce/healthz`, { method: 'GET' });
        const data = await res.json();

        if (data.ok) {
            showStatus(healthStatus, `✅ Servidor OK - ${data.time || 'conectado'}`, 'success');
            log('Health check exitoso', 'success');
            state.serverUrl = url;
        } else {
            showStatus(healthStatus, '❌ El servidor respondió pero con error', 'error');
            log('Health check falló', 'error');
        }
    } catch (err) {
        showStatus(healthStatus, `❌ No se puede conectar: ${err.message}`, 'error');
        log(`Error: ${err.message}`, 'error');
    }
}

async function connect() {
    const url = getServerUrl();
    const shop = 'interhomesmart.com.mx'; // Your test store
    const email = 'albertgpt1@gmail.com';
    const version = '1.0.0';
    const connectionStatus = $('connectionStatus');
    const btnConnect = $('btnConnect');

    btnConnect.disabled = true;
    btnConnect.innerHTML = '<span class="spinner"></span> Conectando...';
    log(`Conectando ${shop} a ${url}...`);

    try {
        const res = await fetch(`${url}/api/woocommerce/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopDomain: shop,
                adminEmail: email,
                pluginVersion: version
            })
        });

        const data = await res.json();

        if (data.ok && data.token) {
            state.connected = true;
            state.token = data.token;
            state.serverUrl = url;
            showStatus(connectionStatus, '✅ ¡Conectado exitosamente!', 'success');
            log(`Conectado. Token: ${data.token.substring(0, 12)}...`, 'success');
            updateConnectionUI();
        } else {
            showStatus(connectionStatus, `❌ Error: ${data.error || 'Respuesta inválida'}`, 'error');
            log(`Error de conexión: ${data.error}`, 'error');
        }
    } catch (err) {
        showStatus(connectionStatus, `❌ Error: ${err.message}`, 'error');
        log(`Error: ${err.message}`, 'error');
    } finally {
        btnConnect.disabled = false;
        btnConnect.innerHTML = '🔗 Conectar Tienda';
    }
}

async function disconnect() {
    if (!state.token) return;

    const btnDisconnect = $('btnDisconnect');
    const connectionStatus = $('connectionStatus');
    btnDisconnect.disabled = true;
    log('Desconectando...');

    try {
        const res = await fetch(`${state.serverUrl}/api/woocommerce/install`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            }
        });

        const data = await res.json();

        if (data.ok) {
            log('Desconectado exitosamente', 'success');
        } else {
            log(`Aviso: ${data.error || 'Error al desconectar'}`, 'error');
        }
    } catch (err) {
        log(`Error al desconectar: ${err.message}`, 'error');
    }

    // Reset state regardless
    state.connected = false;
    state.token = null;
    hideStatus(connectionStatus);
    updateConnectionUI();
    btnDisconnect.disabled = false;
}

async function sendWebhook(eventType, payload) {
    const webhookStatus = $('webhookStatus');

    if (!state.connected || !state.token) {
        showStatus(webhookStatus, '⚠️ Debes conectar primero', 'warning');
        return;
    }

    log(`Enviando webhook: ${eventType}`);

    try {
        const res = await fetch(`${state.serverUrl}/api/woocommerce/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`,
                'X-WC-Webhook-Event': eventType
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.ok) {
            showStatus(webhookStatus, `✅ Webhook ${eventType} enviado`, 'success');
            log(`Webhook ${eventType} enviado correctamente`, 'success');
        } else {
            showStatus(webhookStatus, `❌ Error: ${data.error}`, 'error');
            log(`Error webhook: ${data.error}`, 'error');
        }
    } catch (err) {
        showStatus(webhookStatus, `❌ Error: ${err.message}`, 'error');
        log(`Error: ${err.message}`, 'error');
    }
}

// Sample payloads
function sampleOrder() {
    return {
        id: Math.floor(Math.random() * 10000) + 1000,
        status: 'processing',
        currency: 'MXN',
        total: (Math.random() * 5000 + 100).toFixed(2),
        date_created: new Date().toISOString(),
        billing: {
            first_name: 'Juan',
            last_name: 'Pérez',
            email: 'juan@ejemplo.com',
            city: 'México DF'
        },
        line_items: [
            { id: 1, name: 'Producto de Prueba', quantity: 2, price: '299.00', sku: 'TEST-001' }
        ],
        payment_method: 'stripe',
        customer_id: 42
    };
}

function sampleProduct() {
    return {
        id: Math.floor(Math.random() * 1000) + 100,
        name: 'Producto Demo ' + Date.now(),
        slug: 'producto-demo-' + Date.now(),
        type: 'simple',
        status: 'publish',
        sku: 'DEMO-' + Math.floor(Math.random() * 1000),
        price: (Math.random() * 1000 + 50).toFixed(2),
        regular_price: (Math.random() * 1200 + 100).toFixed(2),
        stock_quantity: Math.floor(Math.random() * 100),
        stock_status: 'instock',
        categories: [{ id: 1, name: 'General' }],
        date_created: new Date().toISOString()
    };
}

function sampleCustomer() {
    const id = Math.floor(Math.random() * 1000) + 1;
    return {
        id,
        email: `cliente${id}@ejemplo.com`,
        first_name: 'Cliente',
        last_name: `Prueba ${id}`,
        role: 'customer',
        date_created: new Date().toISOString(),
        billing: { city: 'Guadalajara', state: 'Jalisco', country: 'MX' },
        orders_count: Math.floor(Math.random() * 20),
        total_spent: (Math.random() * 10000).toFixed(2)
    };
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    // Set up event listeners
    $('btnHealthCheck').addEventListener('click', healthCheck);
    $('btnConnect').addEventListener('click', connect);
    $('btnDisconnect').addEventListener('click', disconnect);
    $('btnTestOrder').addEventListener('click', () => sendWebhook('order.created', sampleOrder()));
    $('btnTestProduct').addEventListener('click', () => sendWebhook('product.updated', sampleProduct()));
    $('btnTestCustomer').addEventListener('click', () => sendWebhook('customer.created', sampleCustomer()));
    $('btnClearLog').addEventListener('click', () => {
        $('logBox').innerHTML = '<div class="log-entry"><span class="log-time">[--:--:--]</span> Log limpiado</div>';
    });

    // Initialize UI
    const serverDisplay = $('serverDisplay');
    if (serverDisplay) {
        serverDisplay.textContent = getServerUrl();
    }
    renderWebhooks();
    updateConnectionUI();
    log('Página de pruebas WooCommerce cargada');
    log(`Servidor: ${getServerUrl()}`);

});
