/**
 * Pixel Auditor AI™ - Page Fetcher
 * Módulo para descargar y procesar páginas web
 */

import { PageContent } from '../../type/AuditResult';

/**
 * Descarga una página web y retorna el HTML completo
 * @param url - URL de la página a auditar
 * @returns Contenido HTML de la página
 */
export async function fetchPage(url: string): Promise<PageContent> {
  try {
    // Validar URL
    const validUrl = new URL(url);
    
    // Descargar página con timeout de 20 segundos
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    
    const response = await fetch(validUrl.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Pixel-Auditor-AI/1.0 (Digital Analytics Crawler)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Extraer scripts inline y externos
    const scripts = extractScriptsFromHTML(html);
    
    return {
      html,
      scripts,
    };
    
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout: La página tardó más de 20 segundos en responder');
      }
      throw new Error(`Error fetching page: ${error.message}`);
    }
    throw new Error('Unknown error fetching page');
  }
}

/**
 * Extrae todos los scripts (inline y externos) del HTML
 * @param html - Contenido HTML de la página
 * @returns Objeto con scripts inline y externos
 */
function extractScriptsFromHTML(html: string): PageContent['scripts'] {
  const scripts: PageContent['scripts'] = {
    inline: [],
    external: [],
  };
  
  // RegEx para extraer tags <script>
  // Captura tanto scripts inline como externos
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  
  while ((match = scriptRegex.exec(html)) !== null) {
    const attributes = match[1];
    const content = match[2];
    
    // Buscar atributo src
    const srcMatch = /src=["']([^"']+)["']/i.exec(attributes);
    
    if (srcMatch) {
      // Script externo
      scripts.external.push({
        src: srcMatch[1],
      });
    } else if (content.trim()) {
      // Script inline
      scripts.inline.push(content);
    }
  }
  
  return scripts;
}

/**
 * Descarga el contenido de un script externo
 * @param scriptUrl - URL del script
 * @returns Contenido del script o null si falla
 */
export async function fetchExternalScript(scriptUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(scriptUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Pixel-Auditor-AI/1.0',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return null;
    }
    
    return await response.text();
    
  } catch (error) {
    // Si falla, simplemente retornamos null
    return null;
  }
}