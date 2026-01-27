/**
 * Pixel Auditor AI™ - Meta Pixel Detector
 * Detecta instalación y configuración de Meta Pixel (Facebook Pixel)
 */

import { MetaPixelResult, PageContent, ScriptInfo } from '../../type/AuditResult';
import { extractAllMatches } from '../crawler/extractScripts';

/**
 * Detecta Meta Pixel en una página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Resultado de auditoría Meta Pixel
 */
export function detectMetaPixel(
  pageContent: PageContent,
  scripts: ScriptInfo[]
): MetaPixelResult {
  const result: MetaPixelResult = {
    detected: false,
    ids: [],
    errors: [],
  };
  
  // Combinar todo el contenido
  const allContent = [
    pageContent.html,
    ...scripts.map(s => s.content),
  ].join('\n');
  
  // Patrón 1: Script de Facebook Pixel (múltiples variantes de dominio/path)
  const fbScriptPattern = /(?:connect\.facebook\.net|facebook\.com)\/[a-z_-]+\/(?:fbevents|sdk)\.js/gi;
  const scriptMatches = extractAllMatches(allContent, fbScriptPattern);
  
  // Patrón 2: fbq('init', 'PIXEL_ID') - Relajado para IDs de 10-20 dígitos
  const fbqInitPattern = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
  const initMatches = extractAllMatches(allContent, fbqInitPattern);
  
  // Patrón 3: _fbq.push(['init', 'PIXEL_ID']) - Legacy
  const fbqPushInitPattern = /_fbq\.push\s*\(\s*\[\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
  const pushInitMatches = extractAllMatches(allContent, fbqPushInitPattern);
  
  // Patrón 4: Configuración de pixel en objeto (pixelId, pixel_id, etc.)
  const pixelIdConfigPattern = /['"]?(?:pixel_?[Ii]d|fb_pixel_id)['"]?\s*[:=]\s*['"]?(\d{10,20})['"]?/gi;
  const configMatches = extractAllMatches(allContent, pixelIdConfigPattern);
  
  // Patrón 5: URL de tracking directo facebook.com/tr?id=XXXXX
  const fbTrackingUrlPattern = /facebook\.com\/tr\?(?:[^"']*&)?id=(\d{10,20})/gi;
  const trackingUrlMatches = extractAllMatches(allContent, fbTrackingUrlPattern);
  
  // Patrón 6: data-attributes con pixel ID
  const dataAttrPattern = /data-(?:fb-?pixel|pixel-id|facebook-pixel)=['"](\d{10,20})['"]/gi;
  const dataAttrMatches = extractAllMatches(allContent, dataAttrPattern);
  
  // Patrón 7: Variables JS comunes para pixel
  const jsVarPattern = /(?:var|let|const)\s+(?:fb_?pixel_?id|pixel_?id|FB_PIXEL_ID)\s*=\s*['"](\d{10,20})['"]/gi;
  const jsVarMatches = extractAllMatches(allContent, jsVarPattern);
  
  // Patrón 8: Meta Pixel en JSON/objetos de configuración
  const jsonConfigPattern = /"(?:meta_?pixel|facebook_?pixel|fb_?pixel)":\s*"(\d{10,20})"/gi;
  const jsonConfigMatches = extractAllMatches(allContent, jsonConfigPattern);
  
  // Patrón 9: fbq.queue con init
  const fbqQueuePattern = /fbq\.queue\.push\s*\(\s*\[\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi;
  const queueMatches = extractAllMatches(allContent, fbqQueuePattern);
  
  // Patrón 10: Shopify/plataformas comunes
  const shopifyPattern = /(?:facebook_pixel_id|fbPixelId)['"]?\s*[:=]\s*['"]?(\d{10,20})['"]?/gi;
  const shopifyMatches = extractAllMatches(allContent, shopifyPattern);
  
  // Recolectar todos los Pixel IDs únicos
  const allIds = new Set<string>();
  
  [initMatches, pushInitMatches, configMatches, trackingUrlMatches, 
   dataAttrMatches, jsVarMatches, jsonConfigMatches, queueMatches, shopifyMatches].forEach(matches => {
    matches.forEach(match => {
      if (match[1]) allIds.add(match[1]);
    });
  });
  
  result.ids = Array.from(allIds);
  result.detected = result.ids.length > 0;
  
  // También detectar si hay script cargado aunque no encontremos ID
  const hasScript = scriptMatches.length > 0 || /fbevents\.js|fbq\s*=\s*function/i.test(allContent);
  
  if (!result.detected && hasScript) {
    // Hay script pero no encontramos ID - puede estar ofuscado
    result.detected = true;
    result.errors.push('pixel_id_not_found');
  }
  
  // Detección de errores
  if (result.detected) {
    // Error: Script cargado pero pixel no inicializado
    if (hasScript && result.ids.length === 0) {
      result.errors.push('pixel_script_without_init');
    }
    
    // Error: Pixel inicializado pero sin script
    if (!hasScript && result.ids.length > 0) {
      result.errors.push('pixel_init_without_script');
    }
    
    // Error: fbq definido múltiples veces (solo en el HTML del sitio, no en scripts externos de Facebook)
    const siteContent = pageContent.html;
    const fbqDefinitions = siteContent.match(/n\s*=\s*f\.fbq\s*=\s*function|window\.fbq\s*=/g);
    if (fbqDefinitions && fbqDefinitions.length > 1) {
      result.errors.push('multiple_fbq_definitions');
    }
    
    // Error: Pixel inicializado múltiples veces (mismo ID)
    // Solo contar inits en el HTML del sitio
    const siteInitMatches = extractAllMatches(siteContent, /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/gi);
    if (siteInitMatches.length > result.ids.length) {
      result.errors.push('pixel_init_multiple_times');
    }
    
    // Warning: No se detectó noscript fallback
    const hasNoscript = /<noscript[^>]*>[\s\S]*?facebook\.com\/tr\?(?:[^"']*&)?id=/i.test(allContent);
    if (!hasNoscript && result.ids.length > 0) {
      result.errors.push('missing_noscript_fallback');
    }
  }
  
  return result;
}

/**
 * Verifica si un Pixel ID es válido
 * @param id - ID a verificar
 * @returns true si es válido
 */
export function isValidPixelId(id: string): boolean {
  // Los Pixel IDs son números de 10-20 dígitos (relajado para cubrir variantes)
  return /^\d{10,20}$/.test(id);
}

/**
 * Detecta la versión del código de Meta Pixel
 * @param content - Contenido donde buscar
 * @returns Versión detectada
 */
export function detectPixelVersion(content: string): {
  version: 'legacy' | 'modern' | 'unknown';
  hasAutoConfig: boolean;
} {
  // Código legacy usa _fbq
  const hasLegacy = /_fbq\.push/.test(content);
  
  // Código moderno usa fbq directamente
  const hasModern = /fbq\s*\(\s*['"]init['"]/.test(content);
  
  // Auto config
  const hasAutoConfig = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{15,16})['"]\s*,\s*\{.*?autoConfig/.test(content);
  
  let version: 'legacy' | 'modern' | 'unknown' = 'unknown';
  
  if (hasModern) {
    version = 'modern';
  } else if (hasLegacy) {
    version = 'legacy';
  }
  
  return {
    version,
    hasAutoConfig,
  };
}

/**
 * Detecta configuraciones avanzadas de Meta Pixel
 * @param content - Contenido donde buscar
 * @returns Configuraciones encontradas
 */
export function extractPixelConfig(content: string): Record<string, any> {
  const config: Record<string, any> = {};
  
  // Buscar configuraciones comunes
  const autoConfigMatch = /autoConfig['"]\s*:\s*(true|false)/i.exec(content);
  if (autoConfigMatch) {
    config.autoConfig = autoConfigMatch[1] === 'true';
  }
  
  const debugMatch = /debug['"]\s*:\s*(true|false)/i.exec(content);
  if (debugMatch) {
    config.debug = debugMatch[1] === 'true';
  }
  
  return config;
}