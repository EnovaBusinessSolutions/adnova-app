/* 
  FRONTEND ENTRY POINT: interface.js
  ----------------------------------
  Se encarga de inicializar App Bridge en el frontend REACT/VITE (SPA).
  Usa App Bridge v4 via CDN (window.shopify).
*/

// Eliminar imports de @shopify/app-bridge-utils o @shopify/app-bridge si existían
// import createApp from '@shopify/app-bridge';
// import { getSessionToken } from '@shopify/app-bridge-utils';

export async function initAppBridge() {
  const urlParams = new URLSearchParams(window.location.search);
  const host = urlParams.get('host');
  const shop = urlParams.get('shop');

  // Si no hay host/shop, probablemente no estamos en embedded mode o falta contexto
  if (!host || !shop) {
    console.warn('initAppBridge: Falta host o shop en URLSearchParams');
    return null;
  }

  // Esperar a que window.shopify esté disponible (inyectado por CDN)
  // En v4, el script se carga en el <head> y expone window.shopify
  // Podemos hacer un pequeño polling si hiciera falta, pero normalmente ya está si el script tag está en index.html
  
  if (!window.shopify) {
     console.error('App Bridge v4 CDN script not loaded on window.shopify');
     return null;
  }
  
  // Configurar (opcional, muchas veces v4 lo toma auto de la URL si se llama igual)
  await window.shopify.config({
      apiKey: import.meta.env.VITE_SHOPIFY_API_KEY, 
      shop: shop,
      forceRedirect: false, 
  });

  return window.shopify;
}

export async function getSessionToken() {
  if (window.shopify && window.shopify.idToken) {
     return await window.shopify.idToken();
  }
  throw new Error('App Bridge v4 idToken() not available');
}
