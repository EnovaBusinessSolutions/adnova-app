/**
 * Pixel Auditor AI™ - Error Descriptions
 * Descripciones detalladas de errores y recomendaciones
 */

export interface ErrorDetail {
  code: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  impact: string;
  solution: string;
  docsUrl?: string;
}

/**
 * Descripciones detalladas de errores de Google Analytics 4
 */
export const GA4_ERRORS: Record<string, ErrorDetail> = {
  multiple_ga4_ids: {
    code: 'multiple_ga4_ids',
    severity: 'warning',
    title: 'Múltiples IDs de GA4 detectados',
    description: 'Se encontraron varios IDs de medición de Google Analytics 4 en la misma página. Esto puede causar datos duplicados y métricas infladas.',
    impact: 'Los eventos y páginas vistas se registrarán múltiples veces, distorsionando las métricas de tráfico, conversiones y comportamiento del usuario.',
    solution: 'Revisa tu implementación y elimina los IDs duplicados. Mantén solo el ID de medición principal (G-XXXXXXXX). Si necesitas enviar datos a múltiples propiedades, configúralo correctamente en GTM.',
    docsUrl: 'https://support.google.com/analytics/answer/9304153',
  },
  ga4_script_without_config: {
    code: 'ga4_script_without_config',
    severity: 'error',
    title: 'Script de GA4 cargado sin configuración',
    description: 'El script gtag.js está cargado en la página, pero no se encontró la llamada gtag("config", "G-XXXXXXXX") necesaria para inicializar el tracking.',
    impact: 'GA4 NO está recopilando datos. Las páginas vistas, eventos y conversiones no se están registrando en absoluto.',
    solution: 'Añade la configuración de gtag después de cargar el script:\n\ngtag("js", new Date());\ngtag("config", "G-XXXXXXXX");',
    docsUrl: 'https://developers.google.com/analytics/devguides/collection/ga4',
  },
  ga4_config_without_script: {
    code: 'ga4_config_without_script',
    severity: 'error',
    title: 'Configuración de GA4 sin script',
    description: 'Se encontró código de configuración de gtag, pero el script gtag.js no está cargado en la página.',
    impact: 'GA4 NO funciona. La función gtag() no existe, por lo que todas las llamadas fallarán silenciosamente.',
    solution: 'Añade el script de gtag.js antes de cualquier llamada a gtag():\n\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>',
    docsUrl: 'https://developers.google.com/analytics/devguides/collection/ga4',
  },
  multiple_gtag_definitions: {
    code: 'multiple_gtag_definitions',
    severity: 'warning',
    title: 'Función gtag() definida múltiples veces',
    description: 'La función gtag() está siendo definida más de una vez en el código. Esto indica que el código de GA4 se ha copiado/pegado varias veces.',
    impact: 'Puede causar comportamiento impredecible, errores de JavaScript, y pérdida de eventos que se enviaron antes de la redefinición.',
    solution: 'Revisa todos los scripts y elimina las definiciones duplicadas de gtag(). La función solo debe definirse una vez, idealmente en el <head>.',
    docsUrl: 'https://developers.google.com/analytics/devguides/collection/ga4',
  },
};

/**
 * Descripciones detalladas de errores de Google Tag Manager
 */
export const GTM_ERRORS: Record<string, ErrorDetail> = {
  duplicate_container: {
    code: 'duplicate_container',
    severity: 'warning',
    title: 'Múltiples contenedores de GTM detectados',
    description: 'Se encontraron varios contenedores de Google Tag Manager (GTM-XXXXXXX) en la misma página.',
    impact: 'Puede causar conflictos entre tags, eventos duplicados, y dificulta la gestión y depuración. También aumenta el tiempo de carga de la página.',
    solution: 'Consolida todos los tags en un solo contenedor de GTM. Si necesitas múltiples contenedores por razones organizativas, asegúrate de que no haya solapamiento de funcionalidad.',
    docsUrl: 'https://support.google.com/tagmanager/answer/6103696',
  },
  missing_noscript_fallback: {
    code: 'missing_noscript_fallback',
    severity: 'warning',
    title: 'Falta el fallback <noscript> de GTM',
    description: 'El iframe de respaldo <noscript> de GTM no está presente. Este elemento permite tracking básico para usuarios con JavaScript deshabilitado.',
    impact: 'Los usuarios con JavaScript deshabilitado no serán rastreados. Esto afecta aproximadamente al 1-2% de los usuarios en la mayoría de sitios.',
    solution: 'Añade el código <noscript> inmediatamente después de la etiqueta <body>:\n\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>',
    docsUrl: 'https://developers.google.com/tag-platform/tag-manager/web',
  },
  datalayer_not_initialized: {
    code: 'datalayer_not_initialized',
    severity: 'error',
    title: 'dataLayer no inicializado correctamente',
    description: 'No se encontró la inicialización estándar del dataLayer (dataLayer = dataLayer || []) antes del código de GTM.',
    impact: 'Los eventos enviados antes de que GTM cargue pueden perderse. Las variables de dataLayer pueden no estar disponibles para los triggers.',
    solution: 'Añade la inicialización del dataLayer ANTES del snippet de GTM:\n\n<script>\nwindow.dataLayer = window.dataLayer || [];\n</script>\n<!-- Google Tag Manager -->',
    docsUrl: 'https://developers.google.com/tag-platform/tag-manager/datalayer',
  },
  multiple_datalayer_init: {
    code: 'multiple_datalayer_init',
    severity: 'warning',
    title: 'dataLayer inicializado múltiples veces',
    description: 'El dataLayer se está inicializando (dataLayer = dataLayer || []) en múltiples lugares del código.',
    impact: 'Aunque esto no causa errores graves, indica una implementación desorganizada que puede dificultar el mantenimiento.',
    solution: 'Centraliza la inicialización del dataLayer en un solo lugar, idealmente en el <head> antes de cualquier otro script.',
    docsUrl: 'https://developers.google.com/tag-platform/tag-manager/datalayer',
  },
  gtm_loaded_multiple_times: {
    code: 'gtm_loaded_multiple_times',
    severity: 'error',
    title: 'GTM cargado múltiples veces',
    description: 'El script de Google Tag Manager se está cargando más de una vez para el mismo contenedor.',
    impact: 'Todos los tags se dispararán múltiples veces, causando datos duplicados, métricas infladas, y potencialmente problemas de rendimiento.',
    solution: 'Elimina las cargas duplicadas del script de GTM. Asegúrate de que solo haya un snippet de GTM por contenedor en toda la página.',
    docsUrl: 'https://support.google.com/tagmanager/answer/6103696',
  },
};

/**
 * Descripciones detalladas de errores de Meta Pixel
 */
export const META_PIXEL_ERRORS: Record<string, ErrorDetail> = {
  multiple_pixel_ids: {
    code: 'multiple_pixel_ids',
    severity: 'warning',
    title: 'Múltiples Pixel IDs detectados',
    description: 'Se encontraron varios IDs de Meta Pixel (Facebook Pixel) en la misma página.',
    impact: 'Los eventos se enviarán a múltiples píxeles, lo que puede causar audiencias duplicadas y métricas de conversión incorrectas en Facebook Ads.',
    solution: 'Mantén solo el Pixel ID principal. Si necesitas múltiples píxeles (por ejemplo, para agencias), usa la función de píxeles secundarios o configúralo correctamente con eventos separados.',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/',
  },
  pixel_script_without_init: {
    code: 'pixel_script_without_init',
    severity: 'error',
    title: 'Script de Meta Pixel sin inicialización',
    description: 'El script fbevents.js está cargado, pero no se encontró la llamada fbq("init", "PIXEL_ID") necesaria.',
    impact: 'Meta Pixel NO está funcionando. No se están rastreando páginas vistas, eventos de conversión ni datos de audiencia.',
    solution: 'Añade la inicialización del pixel después de cargar el script:\n\nfbq("init", "TU_PIXEL_ID");\nfbq("track", "PageView");',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/implementation/conversion-tracking',
  },
  pixel_init_without_script: {
    code: 'pixel_init_without_script',
    severity: 'error',
    title: 'Inicialización sin script de Meta Pixel',
    description: 'Se encontró código de inicialización fbq("init"), pero el script fbevents.js no está cargado.',
    impact: 'Meta Pixel NO funciona. Las llamadas a fbq() fallarán porque la función no existe.',
    solution: 'Asegúrate de incluir el código completo del pixel de Meta, incluyendo la carga del script desde connect.facebook.net.',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/implementation',
  },
  multiple_fbq_definitions: {
    code: 'multiple_fbq_definitions',
    severity: 'warning',
    title: 'Función fbq() definida múltiples veces',
    description: 'El código base del Meta Pixel se ha incluido más de una vez, redefiniendo la función fbq().',
    impact: 'Puede causar pérdida de eventos, comportamiento impredecible y errores en el rastreo de conversiones.',
    solution: 'Revisa tu código y elimina las instalaciones duplicadas del pixel. El código base solo debe aparecer una vez.',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/implementation',
  },
  pixel_init_multiple_times: {
    code: 'pixel_init_multiple_times',
    severity: 'warning',
    title: 'Pixel inicializado múltiples veces',
    description: 'La llamada fbq("init", "PIXEL_ID") se está ejecutando más de una vez para el mismo Pixel ID.',
    impact: 'Cada inicialización adicional puede causar eventos PageView duplicados y distorsionar las métricas de tráfico.',
    solution: 'Asegúrate de que fbq("init") solo se llame una vez por cada Pixel ID único. Revisa si tienes el código duplicado en el HTML y en GTM.',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/implementation',
  },
  missing_noscript_fallback: {
    code: 'missing_noscript_fallback',
    severity: 'info',
    title: 'Falta imagen <noscript> de Meta Pixel',
    description: 'No se encontró la etiqueta <noscript> con la imagen de tracking para usuarios sin JavaScript.',
    impact: 'Los usuarios con JavaScript deshabilitado no serán rastreados (aproximadamente 1-2% del tráfico).',
    solution: 'Añade el fallback noscript del pixel:\n\n<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=TU_PIXEL_ID&ev=PageView&noscript=1"/></noscript>',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/implementation',
  },
  pixel_id_not_found: {
    code: 'pixel_id_not_found',
    severity: 'warning',
    title: 'Meta Pixel detectado pero ID no encontrado',
    description: 'Se detectó el script de Meta Pixel (fbevents.js) pero no se pudo extraer el ID del pixel. Puede estar ofuscado o cargado dinámicamente.',
    impact: 'El pixel probablemente está funcionando, pero no podemos verificar su configuración ni ID.',
    solution: 'Verifica manualmente que el pixel esté correctamente configurado usando el Meta Pixel Helper (extensión de Chrome).',
    docsUrl: 'https://developers.facebook.com/docs/meta-pixel/support/pixel-helper',
  },
};

/**
 * Descripciones detalladas de errores de Google Ads
 */
export const GOOGLE_ADS_ERRORS: Record<string, ErrorDetail> = {
  multiple_google_ads_ids: {
    code: 'multiple_google_ads_ids',
    severity: 'warning',
    title: 'Múltiples IDs de Google Ads detectados',
    description: 'Se encontraron varios IDs de Google Ads (AW-XXXXXXXXXX) en la misma página.',
    impact: 'Puede causar duplicación de conversiones y problemas con el tracking de remarketing.',
    solution: 'Mantén solo el ID de Google Ads principal. Si necesitas múltiples cuentas, configúralo correctamente en GTM o con etiquetas separadas.',
    docsUrl: 'https://support.google.com/google-ads/answer/7548399',
  },
  google_ads_script_without_config: {
    code: 'google_ads_script_without_config',
    severity: 'error',
    title: 'Script de Google Ads cargado sin configuración',
    description: 'El script gtag.js está cargado con un ID de Google Ads, pero no se encontró la llamada gtag("config", "AW-XXXXXXXXXX").',
    impact: 'El remarketing de Google Ads NO está funcionando. Las audiencias no se están construyendo correctamente.',
    solution: 'Añade la configuración de gtag después de cargar el script:\n\ngtag("js", new Date());\ngtag("config", "AW-XXXXXXXXXX");',
    docsUrl: 'https://support.google.com/google-ads/answer/7548399',
  },
  google_ads_config_without_script: {
    code: 'google_ads_config_without_script',
    severity: 'error',
    title: 'Configuración de Google Ads sin script',
    description: 'Se encontró código de configuración de Google Ads, pero el script gtag.js no está cargado.',
    impact: 'Google Ads NO funciona. Las conversiones y el remarketing no se están rastreando.',
    solution: 'Añade el script de gtag.js:\n\n<script async src="https://www.googletagmanager.com/gtag/js?id=AW-XXXXXXXXXX"></script>',
    docsUrl: 'https://support.google.com/google-ads/answer/7548399',
  },
  no_conversion_tracking: {
    code: 'no_conversion_tracking',
    severity: 'info',
    title: 'Sin tracking de conversiones configurado',
    description: 'Google Ads está instalado para remarketing, pero no se detectaron conversiones configuradas (gtag event conversion).',
    impact: 'Solo estás construyendo audiencias de remarketing. No podrás medir cuántas ventas o leads generan tus anuncios.',
    solution: 'Configura el seguimiento de conversiones en Google Ads y añade el código de conversión en las páginas de agradecimiento/confirmación.',
    docsUrl: 'https://support.google.com/google-ads/answer/6095821',
  },
  missing_enhanced_conversions: {
    code: 'missing_enhanced_conversions',
    severity: 'info',
    title: 'Conversiones mejoradas no detectadas',
    description: 'No se detectó la configuración de Enhanced Conversions (allow_enhanced_conversions: true).',
    impact: 'Las conversiones mejoradas permiten un tracking más preciso usando datos de primera parte (email hasheado), especialmente útil con las restricciones de cookies.',
    solution: 'Considera implementar Enhanced Conversions para mejorar la medición:\n\ngtag("config", "AW-XXXXXX", { allow_enhanced_conversions: true });',
    docsUrl: 'https://support.google.com/google-ads/answer/9888656',
  },
};

/**
 * Obtiene los detalles de un error por su código
 */
export function getErrorDetails(errorCode: string): ErrorDetail | null {
  return (
    GA4_ERRORS[errorCode] ||
    GTM_ERRORS[errorCode] ||
    META_PIXEL_ERRORS[errorCode] ||
    GOOGLE_ADS_ERRORS[errorCode] ||
    null
  );
}

/**
 * Obtiene todos los detalles de errores de una lista
 */
export function getErrorsDetails(errorCodes: string[]): ErrorDetail[] {
  return errorCodes
    .map(code => getErrorDetails(code))
    .filter((detail): detail is ErrorDetail => detail !== null);
}