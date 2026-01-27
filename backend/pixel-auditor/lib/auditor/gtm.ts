/**
 * Pixel Auditor AI™ - Google Tag Manager Detector
 * Detecta instalación y configuración de GTM
 */

import { GTMResult, PageContent, ScriptInfo } from '../../type/AuditResult';
import { extractAllMatches } from '../crawler/extractScripts';

/**
 * Detecta Google Tag Manager en una página
 * @param pageContent - Contenido de la página
 * @param scripts - Scripts procesados
 * @returns Resultado de auditoría GTM
 */
export function detectGTM(
  pageContent: PageContent,
  scripts: ScriptInfo[]
): GTMResult {
  const result: GTMResult = {
    detected: false,
    containers: [],
    errors: [],
  };
  
  // Combinar todo el contenido
  const allContent = [
    pageContent.html,
    ...scripts.map(s => s.content),
  ].join('\n');
  
  // Patrón 1: Script de GTM (gtm.js)
  const gtmScriptPattern = /googletagmanager\.com\/gtm\.js\?id=(GTM-[A-Z0-9]+)/gi;
  const scriptMatches = extractAllMatches(allContent, gtmScriptPattern);
  
  // Patrón 2: GTM en iframe (noscript fallback)
  const gtmIframePattern = /googletagmanager\.com\/ns\.html\?id=(GTM-[A-Z0-9]+)/gi;
  const iframeMatches = extractAllMatches(allContent, gtmIframePattern);
  
  // Patrón 3: Inicialización de dataLayer
  const dataLayerPattern = /dataLayer\s*=\s*(?:dataLayer\s*\|\|\s*)?\[\]/gi;
  const dataLayerInitMatches = extractAllMatches(allContent, dataLayerPattern);
  
  // Patrón 4: GTM ID en configuración manual (gtm.start)
  const gtmConfigPattern = /['"]gtm\.start['"]\s*:[\s\S]*?['"](GTM-[A-Z0-9]+)['"]/gi;
  const configMatches = extractAllMatches(allContent, gtmConfigPattern);
  
  // Patrón 5: GTM- ID en cualquier contexto de string
  const anyGtmIdPattern = /['"](GTM-[A-Z0-9]{5,10})['"]/gi;
  const anyGtmMatches = extractAllMatches(allContent, anyGtmIdPattern);
  
  // Patrón 6: data-attributes con GTM ID
  const dataAttrPattern = /data-(?:gtm|tag-manager|container)=['"]?(GTM-[A-Z0-9]+)['"]?/gi;
  const dataAttrMatches = extractAllMatches(allContent, dataAttrPattern);
  
  // Patrón 7: Variables JS con GTM ID
  const jsVarPattern = /(?:var|let|const)\s+(?:gtm_?id|container_?id|GTM_ID|CONTAINER_ID)\s*=\s*['"](GTM-[A-Z0-9]+)['"]/gi;
  const jsVarMatches = extractAllMatches(allContent, jsVarPattern);
  
  // Patrón 8: GTM en JSON config
  const jsonConfigPattern = /"(?:gtm_?id|container_?id|tag_manager)":\s*"(GTM-[A-Z0-9]+)"/gi;
  const jsonConfigMatches = extractAllMatches(allContent, jsonConfigPattern);
  
  // Patrón 9: Shopify/Wordpress/otras plataformas
  const platformPattern = /(?:google_tag_manager|gtmContainerId|gtmId)['"]?\s*[:=]\s*['"](GTM-[A-Z0-9]+)['"]/gi;
  const platformMatches = extractAllMatches(allContent, platformPattern);
  
  // Patrón 10: GTM snippet dinámico
  const dynamicLoadPattern = /new\s+Date\(\)\.getTime\(\)[\s\S]*?(GTM-[A-Z0-9]+)/gi;
  const dynamicMatches = extractAllMatches(allContent, dynamicLoadPattern);
  
  // Patrón 11: GTM en window/global variable
  const windowPattern = /window\.(?:gtmId|GTM_ID|containerId)\s*=\s*['"](GTM-[A-Z0-9]+)['"]/gi;
  const windowMatches = extractAllMatches(allContent, windowPattern);
  
  // Lista de falsos positivos conocidos
  const falsePositives = new Set([
    'GTM-TEMPLATE', 'GTM-INDEX', 'GTM-EXAMPLE', 'GTM-XXXXXX',
    'GTM-TEST', 'GTM-DEBUG', 'GTM-PLACEHOLDER',
  ]);
  
  // Recolectar todos los container IDs únicos
  const allContainers = new Set<string>();
  
  [scriptMatches, iframeMatches, configMatches, anyGtmMatches,
   dataAttrMatches, jsVarMatches, jsonConfigMatches, platformMatches,
   dynamicMatches, windowMatches].forEach(matches => {
    matches.forEach(match => {
      if (match[1]) {
        const id = match[1].toUpperCase();
        // Validar: formato correcto, contiene al menos un dígito, no es falso positivo
        if (/^GTM-[A-Z0-9]{5,10}$/i.test(id) &&
            /\d/.test(id) &&  // Debe contener al menos un dígito
            !falsePositives.has(id)) {
          allContainers.add(id);
        }
      }
    });
  });
  
  result.containers = Array.from(allContainers);
  result.detected = result.containers.length > 0;
  
  // Detección de errores
  if (result.detected) {
    // Error: Script sin iframe (falta noscript fallback)
    const hasScript = scriptMatches.length > 0;
    const hasIframe = iframeMatches.length > 0;
    
    if (hasScript && !hasIframe) {
      result.errors.push('missing_noscript_fallback');
    }
    
    // Error: dataLayer no inicializado
    const hasDataLayerInit = dataLayerInitMatches.length > 0 || /window\.dataLayer\s*=/.test(allContent);
    if (!hasDataLayerInit) {
      result.errors.push('datalayer_not_initialized');
    }
    
    // Error: Múltiples inicializaciones de dataLayer
    if (dataLayerInitMatches.length > 1) {
      result.errors.push('multiple_datalayer_init');
    }
    
    // Error: GTM cargado múltiples veces (mismo container)
    const scriptCount = scriptMatches.length;
    if (scriptCount > result.containers.length) {
      result.errors.push('gtm_loaded_multiple_times');
    }
  }
  
  return result;
}

/**
 * Verifica si un ID de GTM es válido
 * @param id - ID a verificar
 * @returns true si es válido
 */
export function isValidGTMId(id: string): boolean {
  return /^GTM-[A-Z0-9]{6,}$/.test(id);
}

/**
 * Detecta si dataLayer existe y está correctamente inicializado
 * @param content - Contenido donde buscar
 * @returns Información sobre dataLayer
 */
export function analyzeDataLayer(content: string): {
  exists: boolean;
  initialized: boolean;
  multipleInits: boolean;
} {
  const dataLayerInitPattern = /dataLayer\s*=\s*dataLayer\s*\|\|\s*\[\]/g;
  const dataLayerUsagePattern = /dataLayer\.push/g;
  
  const initMatches = content.match(dataLayerInitPattern);
  const usageMatches = content.match(dataLayerUsagePattern);
  
  return {
    exists: (initMatches?.length ?? 0) > 0 || (usageMatches?.length ?? 0) > 0,
    initialized: (initMatches?.length ?? 0) > 0,
    multipleInits: (initMatches?.length ?? 0) > 1,
  };
}