/**
 * Pixel Auditor AI™ - Google Analytics 4 Detector
 * Detecta instalación y configuración de GA4
 */

import { GA4Result, PageContent, ScriptInfo } from '../../type/AuditResult';
import { extractAllMatches } from '../crawler/extractScripts';

/**
 * Detecta Google Analytics 4 en una página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Resultado de auditoría GA4
 */
export function detectGA4(
  pageContent: PageContent,
  scripts: ScriptInfo[]
): GA4Result {
  const result: GA4Result = {
    detected: false,
    ids: [],
    errors: [],
  };
  
  // Combinar todo el contenido para análisis
  const allContent = [
    pageContent.html,
    ...scripts.map(s => s.content),
  ].join('\n');
  
  // Patrón 1: Script de GA4 via gtag.js
  const ga4ScriptPattern = /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/gi;
  const scriptMatches = extractAllMatches(allContent, ga4ScriptPattern);
  
  // Patrón 2: gtag config con G-
  const gtagConfigPattern = /gtag\s*\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/gi;
  const configMatches = extractAllMatches(allContent, gtagConfigPattern);
  
  // Patrón 3: measurement_id en configuración
  const measurementIdPattern = /['"]measurement_id['"]\s*:\s*['"](G-[A-Z0-9]+)['"]/gi;
  const measurementMatches = extractAllMatches(allContent, measurementIdPattern);
  
  // Patrón 4: G- ID en cualquier contexto de string
  const anyGIdPattern = /['"](G-[A-Z0-9]{6,12})['"]/gi;
  const anyGMatches = extractAllMatches(allContent, anyGIdPattern);
  
  // Patrón 5: data-attributes con GA4 ID
  const dataAttrPattern = /data-(?:ga4?|analytics|measurement)=['"]?(G-[A-Z0-9]+)['"]?/gi;
  const dataAttrMatches = extractAllMatches(allContent, dataAttrPattern);
  
  // Patrón 6: Variables JS con GA4 ID
  const jsVarPattern = /(?:var|let|const)\s+(?:ga4_?id|measurement_?id|tracking_?id|GA4_ID|MEASUREMENT_ID)\s*=\s*['"](G-[A-Z0-9]+)['"]/gi;
  const jsVarMatches = extractAllMatches(allContent, jsVarPattern);
  
  // Patrón 7: GA4 en JSON config
  const jsonConfigPattern = /"(?:ga4|measurement_id|tracking_id|analytics_id)":\s*"(G-[A-Z0-9]+)"/gi;
  const jsonConfigMatches = extractAllMatches(allContent, jsonConfigPattern);
  
  // Patrón 8: Universal Analytics upgraded to GA4 (gtag.js con G-)
  const gtagJsPattern = /gtag\.js\?id=(G-[A-Z0-9]+)/gi;
  const gtagJsMatches = extractAllMatches(allContent, gtagJsPattern);
  
  // Patrón 9: Shopify/Wordpress/otras plataformas
  const platformPattern = /(?:googleAnalytics|ga4Id|gaTrackingId)['"]?\s*[:=]\s*['"](G-[A-Z0-9]+)['"]/gi;
  const platformMatches = extractAllMatches(allContent, platformPattern);
  
  // Patrón 10: Google Analytics collect endpoint (GA4)
  const collectPattern = /google-analytics\.com\/g\/collect\?.*?tid=(G-[A-Z0-9]+)/gi;
  const collectMatches = extractAllMatches(allContent, collectPattern);
  
  // Lista de falsos positivos conocidos que coinciden con el patrón G-XXXX
  const falsePositives = new Set([
    'G-RECAPTCHA', 'G-SAMPLING', 'G-ANIMATION', 
    'G-IMAGE', 'G-VIDEO', 'G-AUDIO',
  ]);
  
  // Recolectar todos los IDs únicos
  const allIds = new Set<string>();
  
  [scriptMatches, configMatches, measurementMatches, anyGMatches, 
   dataAttrMatches, jsVarMatches, jsonConfigMatches, gtagJsMatches,
   platformMatches, collectMatches].forEach(matches => {
    matches.forEach(match => {
      if (match[1]) {
        const originalId = match[1];
        const id = originalId.toUpperCase();
        
        // Validaciones:
        // 1. Formato correcto (G- seguido de 6-12 caracteres alfanuméricos)
        // 2. Debe contener al menos un dígito
        // 3. No puede ser solo letras después del G-
        // 4. No es un falso positivo conocido
        // 5. Si el original tiene minúsculas mezcladas de forma irregular, es sospechoso
        //    (los IDs reales son o todo mayúsculas o vienen de JSON donde son consistentes)
        const hasValidFormat = /^G-[A-Z0-9]{6,12}$/i.test(originalId);
        const hasDigit = /\d/.test(id);
        const isNotOnlyLetters = !/^G-[A-Z]+$/i.test(id);
        const isNotFalsePositive = !falsePositives.has(id);
        
        // Detectar IDs sospechosos con mezcla irregular de mayúsculas/minúsculas
        // Los IDs reales de Google son consistentemente mayúsculas o minúsculas
        const hasSuspiciousCasing = /[a-z]/.test(originalId) && /[A-Z]/.test(originalId.substring(2));
        
        if (hasValidFormat && hasDigit && isNotOnlyLetters && isNotFalsePositive && !hasSuspiciousCasing) {
          allIds.add(id);
        }
      }
    });
  });
  
  result.ids = Array.from(allIds);
  result.detected = result.ids.length > 0;
  
  // Detección de errores
  if (result.detected) {
    // Error: Script cargado pero no configurado
    const hasScript = scriptMatches.length > 0 || gtagJsMatches.length > 0;
    const hasConfig = configMatches.length > 0 || measurementMatches.length > 0;
    
    if (hasScript && !hasConfig) {
      result.errors.push('ga4_script_without_config');
    }
    
    // Error: Configurado pero sin script
    const hasAnyGtagScript = /googletagmanager\.com\/gtag\/js/i.test(allContent);
    if (!hasAnyGtagScript && hasConfig) {
      result.errors.push('ga4_config_without_script');
    }
    
    // Detectar si gtag está definido múltiples veces en el HTML del sitio (no en scripts externos de Google)
    // Solo buscamos en el HTML original, no en scripts cargados externamente
    const siteContent = pageContent.html;
    const gtagDefinitions = siteContent.match(/function\s+gtag\s*\(\s*\)\s*\{/g);
    if (gtagDefinitions && gtagDefinitions.length > 1) {
      result.errors.push('multiple_gtag_definitions');
    }
  }
  
  return result;
}

/**
 * Verifica si un ID de GA4 es válido
 * @param id - ID a verificar
 * @returns true si es válido
 */
export function isValidGA4Id(id: string): boolean {
  return /^G-[A-Z0-9]{10,}$/.test(id);
}

/**
 * Extrae configuración adicional de GA4
 * @param content - Contenido donde buscar
 * @returns Objeto con configuración encontrada
 */
export function extractGA4Config(content: string): Record<string, any> {
  const config: Record<string, any> = {};
  
  // Buscar configuraciones comunes
  const patterns = {
    send_page_view: /['"]send_page_view['"]\s*:\s*(true|false)/i,
    cookie_domain: /['"]cookie_domain['"]\s*:\s*['"]([^'"]+)['"]/i,
    cookie_flags: /['"]cookie_flags['"]\s*:\s*['"]([^'"]+)['"]/i,
    anonymize_ip: /['"]anonymize_ip['"]\s*:\s*(true|false)/i,
  };
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = pattern.exec(content);
    if (match && match[1]) {
      config[key] = match[1] === 'true' ? true : match[1] === 'false' ? false : match[1];
    }
  }
  
  return config;
}