"use strict";
/**
 * Pixel Auditor AI™ - Event Descriptions
 * Descripciones detalladas de eventos estándar y personalizados
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GTM_EVENTS = exports.GA4_EVENTS = exports.META_PIXEL_EVENTS = void 0;
exports.getEventDetails = getEventDetails;
exports.analyzeEventParams = analyzeEventParams;
/**
 * Eventos estándar de Meta Pixel
 */
exports.META_PIXEL_EVENTS = {
    PageView: {
        name: 'PageView',
        category: 'standard',
        title: 'Página Vista',
        description: 'Registra cuando un usuario visita cualquier página del sitio. Es el evento más básico y debe dispararse en cada página.',
        expectedParams: [],
        bestPractices: [
            'Debe dispararse una sola vez por carga de página',
            'Debería ser el primer evento después de fbq("init")',
            'No requiere parámetros adicionales',
        ],
        platform: 'MetaPixel',
    },
    ViewContent: {
        name: 'ViewContent',
        category: 'engagement',
        title: 'Ver Contenido',
        description: 'Registra cuando un usuario ve una página clave, como una página de producto, artículo o landing page específica.',
        expectedParams: [
            { name: 'content_name', type: 'string', required: false, description: 'Nombre del producto o contenido visualizado' },
            { name: 'content_ids', type: 'array', required: false, description: 'IDs de los productos visualizados' },
            { name: 'content_type', type: 'string', required: false, description: 'Tipo de contenido (ej: "product", "article")' },
            { name: 'value', type: 'number', required: false, description: 'Valor monetario del contenido' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda (ej: "USD", "EUR", "MXN")' },
        ],
        bestPractices: [
            'Usa content_ids para mejorar el remarketing dinámico',
            'Incluye value y currency para productos',
            'El content_type ayuda a segmentar audiencias',
        ],
        platform: 'MetaPixel',
    },
    AddToCart: {
        name: 'AddToCart',
        category: 'ecommerce',
        title: 'Añadir al Carrito',
        description: 'Registra cuando un usuario añade un producto al carrito de compras. Evento clave para remarketing de carritos abandonados.',
        expectedParams: [
            { name: 'content_ids', type: 'array', required: true, description: 'IDs de los productos añadidos' },
            { name: 'content_name', type: 'string', required: false, description: 'Nombre del producto' },
            { name: 'content_type', type: 'string', required: true, description: 'Debe ser "product"' },
            { name: 'value', type: 'number', required: true, description: 'Precio del producto' },
            { name: 'currency', type: 'string', required: true, description: 'Moneda del precio' },
        ],
        bestPractices: [
            'Siempre incluye content_ids para remarketing dinámico',
            'El value debe ser el precio unitario × cantidad',
            'Dispara inmediatamente al hacer clic en "Añadir al carrito"',
        ],
        platform: 'MetaPixel',
    },
    InitiateCheckout: {
        name: 'InitiateCheckout',
        category: 'ecommerce',
        title: 'Iniciar Checkout',
        description: 'Registra cuando un usuario comienza el proceso de pago. Indica alta intención de compra.',
        expectedParams: [
            { name: 'content_ids', type: 'array', required: false, description: 'IDs de productos en el carrito' },
            { name: 'contents', type: 'array', required: false, description: 'Array con detalles de productos' },
            { name: 'num_items', type: 'number', required: false, description: 'Cantidad total de items' },
            { name: 'value', type: 'number', required: true, description: 'Valor total del carrito' },
            { name: 'currency', type: 'string', required: true, description: 'Moneda' },
        ],
        bestPractices: [
            'Dispara al entrar a la página de checkout',
            'Incluye el valor total del carrito',
            'Útil para optimizar campañas hacia checkout',
        ],
        platform: 'MetaPixel',
    },
    Purchase: {
        name: 'Purchase',
        category: 'conversion',
        title: 'Compra Completada',
        description: 'El evento más importante para ecommerce. Registra una transacción completada exitosamente.',
        expectedParams: [
            { name: 'content_ids', type: 'array', required: true, description: 'IDs de productos comprados' },
            { name: 'content_type', type: 'string', required: true, description: 'Debe ser "product"' },
            { name: 'value', type: 'number', required: true, description: 'Valor total de la compra' },
            { name: 'currency', type: 'string', required: true, description: 'Moneda de la transacción' },
            { name: 'num_items', type: 'number', required: false, description: 'Cantidad de items' },
        ],
        bestPractices: [
            'DEBE incluir value y currency para medir ROAS',
            'Dispara solo en la página de confirmación de pedido',
            'Usa deduplicación si disparas desde servidor y cliente',
            'El value debe excluir impuestos/envío si es posible',
        ],
        platform: 'MetaPixel',
    },
    Lead: {
        name: 'Lead',
        category: 'conversion',
        title: 'Lead Generado',
        description: 'Registra cuando un usuario completa un formulario de contacto, solicita información o se convierte en lead.',
        expectedParams: [
            { name: 'content_name', type: 'string', required: false, description: 'Nombre del formulario o oferta' },
            { name: 'content_category', type: 'string', required: false, description: 'Categoría del lead' },
            { name: 'value', type: 'number', required: false, description: 'Valor estimado del lead' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda del valor' },
        ],
        bestPractices: [
            'Dispara al enviar exitosamente el formulario',
            'Asigna un value basado en tu tasa de conversión histórica',
            'Diferencia tipos de leads con content_category',
        ],
        platform: 'MetaPixel',
    },
    CompleteRegistration: {
        name: 'CompleteRegistration',
        category: 'conversion',
        title: 'Registro Completado',
        description: 'Registra cuando un usuario completa un registro de cuenta, suscripción o membresía.',
        expectedParams: [
            { name: 'content_name', type: 'string', required: false, description: 'Nombre del tipo de registro' },
            { name: 'status', type: 'string', required: false, description: 'Estado del registro' },
            { name: 'value', type: 'number', required: false, description: 'Valor del registro' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda' },
        ],
        bestPractices: [
            'Dispara después de confirmar el email si es requerido',
            'Incluye el tipo de cuenta creada en content_name',
        ],
        platform: 'MetaPixel',
    },
    Search: {
        name: 'Search',
        category: 'engagement',
        title: 'Búsqueda',
        description: 'Registra cuando un usuario realiza una búsqueda en el sitio. Útil para entender la intención del usuario.',
        expectedParams: [
            { name: 'search_string', type: 'string', required: true, description: 'Término de búsqueda utilizado' },
            { name: 'content_category', type: 'string', required: false, description: 'Categoría donde se busca' },
        ],
        bestPractices: [
            'Captura el término exacto buscado',
            'Útil para crear audiencias basadas en intención',
            'Analiza términos sin resultados para mejorar el sitio',
        ],
        platform: 'MetaPixel',
    },
    AddPaymentInfo: {
        name: 'AddPaymentInfo',
        category: 'ecommerce',
        title: 'Añadir Info de Pago',
        description: 'Registra cuando un usuario ingresa información de pago durante el checkout.',
        expectedParams: [
            { name: 'content_ids', type: 'array', required: false, description: 'IDs de productos' },
            { name: 'value', type: 'number', required: false, description: 'Valor del carrito' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda' },
        ],
        bestPractices: [
            'Dispara al validar exitosamente la tarjeta',
            'Indica usuarios muy cerca de convertir',
            'Útil para remarketing de alta intención',
        ],
        platform: 'MetaPixel',
    },
    AddToWishlist: {
        name: 'AddToWishlist',
        category: 'engagement',
        title: 'Añadir a Lista de Deseos',
        description: 'Registra cuando un usuario añade un producto a su lista de deseos o favoritos.',
        expectedParams: [
            { name: 'content_ids', type: 'array', required: false, description: 'IDs de productos' },
            { name: 'content_name', type: 'string', required: false, description: 'Nombre del producto' },
            { name: 'value', type: 'number', required: false, description: 'Precio del producto' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda' },
        ],
        bestPractices: [
            'Útil para remarketing de productos guardados',
            'Incluye content_ids para anuncios dinámicos',
        ],
        platform: 'MetaPixel',
    },
    Contact: {
        name: 'Contact',
        category: 'conversion',
        title: 'Contacto',
        description: 'Registra intentos de contacto como llamadas, emails o mensajes.',
        expectedParams: [],
        bestPractices: [
            'Usa para trackear clics en "Llamar ahora"',
            'Útil para negocios locales',
        ],
        platform: 'MetaPixel',
    },
    Subscribe: {
        name: 'Subscribe',
        category: 'conversion',
        title: 'Suscripción',
        description: 'Registra cuando un usuario se suscribe a un servicio, newsletter o plan.',
        expectedParams: [
            { name: 'value', type: 'number', required: false, description: 'Valor de la suscripción' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda' },
            { name: 'predicted_ltv', type: 'number', required: false, description: 'Valor de vida predicho' },
        ],
        bestPractices: [
            'Incluye el valor mensual o anual de la suscripción',
            'Diferencia entre planes con content_name',
        ],
        platform: 'MetaPixel',
    },
};
/**
 * Eventos estándar de GA4
 */
exports.GA4_EVENTS = {
    page_view: {
        name: 'page_view',
        category: 'standard',
        title: 'Página Vista',
        description: 'Evento automático que registra cada vez que un usuario carga una página. Es el evento fundamental de GA4.',
        expectedParams: [
            { name: 'page_title', type: 'string', required: false, description: 'Título de la página' },
            { name: 'page_location', type: 'string', required: false, description: 'URL completa' },
            { name: 'page_referrer', type: 'string', required: false, description: 'URL de referencia' },
        ],
        bestPractices: [
            'Se envía automáticamente, no lo dupliques',
            'Configura send_page_view: false si usas SPA',
        ],
        platform: 'GA4',
    },
    first_visit: {
        name: 'first_visit',
        category: 'standard',
        title: 'Primera Visita',
        description: 'Evento automático que se dispara la primera vez que un usuario visita el sitio. Útil para medir nuevos usuarios.',
        expectedParams: [],
        bestPractices: [
            'Es automático, no lo implementes manualmente',
            'Usa la métrica "Nuevos usuarios" en informes',
        ],
        platform: 'GA4',
    },
    session_start: {
        name: 'session_start',
        category: 'standard',
        title: 'Inicio de Sesión',
        description: 'Evento automático que marca el inicio de una nueva sesión de usuario.',
        expectedParams: [],
        bestPractices: [
            'Es automático, no lo implementes manualmente',
            'Una sesión expira tras 30 min de inactividad',
        ],
        platform: 'GA4',
    },
    purchase: {
        name: 'purchase',
        category: 'ecommerce',
        title: 'Compra',
        description: 'Evento de conversión principal para ecommerce. Registra una transacción completada.',
        expectedParams: [
            { name: 'transaction_id', type: 'string', required: true, description: 'ID único de la transacción' },
            { name: 'value', type: 'number', required: true, description: 'Valor total de la compra' },
            { name: 'currency', type: 'string', required: true, description: 'Código de moneda (USD, EUR, MXN)' },
            { name: 'items', type: 'array', required: true, description: 'Array de productos comprados' },
        ],
        bestPractices: [
            'Siempre incluye transaction_id para deduplicación',
            'El array items debe tener item_id y item_name',
            'Dispara solo una vez por transacción',
        ],
        platform: 'GA4',
    },
    add_to_cart: {
        name: 'add_to_cart',
        category: 'ecommerce',
        title: 'Añadir al Carrito',
        description: 'Registra cuando un producto se añade al carrito de compras.',
        expectedParams: [
            { name: 'currency', type: 'string', required: true, description: 'Moneda' },
            { name: 'value', type: 'number', required: true, description: 'Valor del producto' },
            { name: 'items', type: 'array', required: true, description: 'Array con el producto añadido' },
        ],
        bestPractices: [
            'Incluye la cantidad añadida en items.quantity',
            'El value debe ser precio × cantidad',
        ],
        platform: 'GA4',
    },
    begin_checkout: {
        name: 'begin_checkout',
        category: 'ecommerce',
        title: 'Iniciar Checkout',
        description: 'Registra cuando el usuario inicia el proceso de pago.',
        expectedParams: [
            { name: 'currency', type: 'string', required: true, description: 'Moneda' },
            { name: 'value', type: 'number', required: true, description: 'Valor total del carrito' },
            { name: 'items', type: 'array', required: true, description: 'Productos en el carrito' },
            { name: 'coupon', type: 'string', required: false, description: 'Código de cupón aplicado' },
        ],
        bestPractices: [
            'Dispara al entrar al primer paso del checkout',
            'Incluye todos los items del carrito',
        ],
        platform: 'GA4',
    },
    generate_lead: {
        name: 'generate_lead',
        category: 'conversion',
        title: 'Generar Lead',
        description: 'Registra cuando un usuario envía un formulario de contacto o se convierte en lead.',
        expectedParams: [
            { name: 'value', type: 'number', required: false, description: 'Valor estimado del lead' },
            { name: 'currency', type: 'string', required: false, description: 'Moneda' },
        ],
        bestPractices: [
            'Asigna un valor basado en tasa de conversión',
            'Configura como conversión en GA4',
        ],
        platform: 'GA4',
    },
    sign_up: {
        name: 'sign_up',
        category: 'conversion',
        title: 'Registro',
        description: 'Registra cuando un usuario crea una nueva cuenta.',
        expectedParams: [
            { name: 'method', type: 'string', required: false, description: 'Método de registro (email, Google, Facebook)' },
        ],
        bestPractices: [
            'Incluye el método de registro para análisis',
            'Dispara tras confirmar el registro',
        ],
        platform: 'GA4',
    },
    login: {
        name: 'login',
        category: 'engagement',
        title: 'Login',
        description: 'Registra cuando un usuario inicia sesión en su cuenta.',
        expectedParams: [
            { name: 'method', type: 'string', required: false, description: 'Método de login' },
        ],
        bestPractices: [
            'Útil para medir usuarios recurrentes',
            'Incluye el método de autenticación',
        ],
        platform: 'GA4',
    },
    search: {
        name: 'search',
        category: 'engagement',
        title: 'Búsqueda',
        description: 'Registra cuando un usuario realiza una búsqueda en el sitio.',
        expectedParams: [
            { name: 'search_term', type: 'string', required: true, description: 'Término buscado' },
        ],
        bestPractices: [
            'Captura el término exacto buscado',
            'Analiza búsquedas sin resultados',
        ],
        platform: 'GA4',
    },
    view_item: {
        name: 'view_item',
        category: 'ecommerce',
        title: 'Ver Producto',
        description: 'Registra cuando un usuario ve la página de detalle de un producto.',
        expectedParams: [
            { name: 'currency', type: 'string', required: true, description: 'Moneda' },
            { name: 'value', type: 'number', required: true, description: 'Precio del producto' },
            { name: 'items', type: 'array', required: true, description: 'Producto visualizado' },
        ],
        bestPractices: [
            'Dispara en páginas de detalle de producto',
            'Incluye todos los datos del producto',
        ],
        platform: 'GA4',
    },
};
/**
 * Eventos comunes de GTM/dataLayer
 */
exports.GTM_EVENTS = {
    'gtm.js': {
        name: 'gtm.js',
        category: 'standard',
        title: 'GTM Cargado',
        description: 'Evento automático que indica que Google Tag Manager ha terminado de cargar.',
        expectedParams: [],
        bestPractices: [
            'Es automático, no lo implementes manualmente',
            'Útil como trigger para tags que requieren GTM listo',
        ],
        platform: 'GTM',
    },
    'gtm.dom': {
        name: 'gtm.dom',
        category: 'standard',
        title: 'DOM Listo',
        description: 'Evento automático que indica que el DOM está completamente cargado.',
        expectedParams: [],
        bestPractices: [
            'Equivalente a DOMContentLoaded',
            'Útil para triggers que necesitan elementos del DOM',
        ],
        platform: 'GTM',
    },
    'gtm.load': {
        name: 'gtm.load',
        category: 'standard',
        title: 'Página Completamente Cargada',
        description: 'Evento automático que indica que la página (incluyendo recursos) está completamente cargada.',
        expectedParams: [],
        bestPractices: [
            'Equivalente a window.onload',
            'Útil para tags que deben esperar carga completa',
        ],
        platform: 'GTM',
    },
    'gtm.click': {
        name: 'gtm.click',
        category: 'engagement',
        title: 'Clic',
        description: 'Evento que se puede configurar para capturar clics en elementos.',
        expectedParams: [
            { name: 'gtm.element', type: 'object', required: false, description: 'Elemento clicado' },
            { name: 'gtm.elementClasses', type: 'string', required: false, description: 'Clases del elemento' },
            { name: 'gtm.elementId', type: 'string', required: false, description: 'ID del elemento' },
        ],
        bestPractices: [
            'Configura Click Trigger en GTM',
            'Útil para trackear CTAs y botones',
        ],
        platform: 'GTM',
    },
};
/**
 * Obtiene los detalles de un evento por su nombre y tipo
 */
function getEventDetails(eventName, platform) {
    switch (platform) {
        case 'GA4':
            return exports.GA4_EVENTS[eventName] || null;
        case 'GTM':
            return exports.GTM_EVENTS[eventName] || null;
        case 'MetaPixel':
            return exports.META_PIXEL_EVENTS[eventName] || null;
        default:
            return null;
    }
}
/**
 * Analiza los parámetros de un evento y retorna advertencias
 */
function analyzeEventParams(eventName, platform, params = {}) {
    const eventDetail = getEventDetails(eventName, platform);
    const missingRequired = [];
    const warnings = [];
    if (!eventDetail) {
        warnings.push(`Evento "${eventName}" no es un evento estándar reconocido. Considera usar eventos estándar para mejor optimización.`);
        return { missingRequired, warnings };
    }
    // Verificar parámetros requeridos
    eventDetail.expectedParams
        .filter(p => p.required)
        .forEach(param => {
        if (!(param.name in params) || params[param.name] === undefined || params[param.name] === '') {
            missingRequired.push(param.name);
        }
    });
    if (missingRequired.length > 0) {
        warnings.push(`Faltan parámetros requeridos: ${missingRequired.join(', ')}`);
    }
    // Verificar parámetros vacíos
    if (Object.keys(params).length === 0 && eventDetail.expectedParams.length > 0) {
        warnings.push('El evento se envía sin parámetros. Considera añadir datos para mejor análisis.');
    }
    return { missingRequired, warnings };
}
