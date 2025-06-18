// public/js/onboarding.js

import createApp from "@shopify/app-bridge";
import { getSessionToken } from "@shopify/app-bridge/utilities";
import { apiFetch } from "./apiFetch.js";

document.addEventListener('DOMContentLoaded', async () => {
  /* -------------------------------- App Bridge -------------------------------- */
  const qs            = new URLSearchParams(location.search);
  const hostFromQuery = qs.get('host');  // “host” en base64
  const apiKey        = document
    .querySelector("script[data-api-key]")
    .dataset.apiKey;

  // 1️⃣ Inicializa App Bridge con la API Key y el host
  const app = createApp({ apiKey, host: hostFromQuery });
  console.log("🪄 Shopify App Bridge loaded", app);

  // 2️⃣ Llamada de prueba para generar un XHR con JWT
  try {
    const pingRes = await apiFetch("/api/secure/ping");
    console.log("PING ok:", pingRes);
  } catch (err) {
    console.error("PING error:", err);
  }

  /* -------------------------------- DOM -------------------------------- */
  const shopFromQuery    = qs.get('shop');     
  const connectBtn       = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn = document.getElementById('connect-google-btn');
  const continueBtn      = document.getElementById('continue-btn');
  const flagShopify      = document.getElementById('shopifyConnectedFlag');
  const flagGoogle       = document.getElementById('googleConnectedFlag');
  const domainStep       = document.getElementById('shopify-domain-step');
  const domainInput      = document.getElementById('shop-domain-input');
  const domainSend       = document.getElementById('shop-domain-send');

  /* ------- Si venimos de /connector/interface?shop=... activamos el step ------- */
  if (shopFromQuery) {
    domainStep.classList.remove('step--hidden');
    domainInput.value = shopFromQuery;
    domainInput.focus();
  }

  /* ----------------------- Funciones de estado ----------------------- */
  function habilitarContinue() {
    if (!continueBtn) return;
    const done =
      flagShopify.textContent.trim() === 'true' ||
      sessionStorage.getItem('shopifyConnected') === 'true';
    if (done) {
      continueBtn.disabled = false;
      continueBtn.classList.replace('btn-continue--disabled', 'btn-continue--enabled');
      sessionStorage.removeItem('shopifyConnected');
    }
  }

  function pintarShopifyConectado() {
    connectBtn.textContent = 'Connected';
    connectBtn.classList.add('connected');
    connectBtn.disabled = true;
    habilitarContinue();
  }

  function pintarGoogleConectado() {
    connectGoogleBtn.textContent = 'Connected';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
  }

  /* ----------------------- Renderizado inicial ----------------------- */
  if (flagShopify.textContent.trim() === 'true') pintarShopifyConectado();
  if (flagGoogle.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  /* ---------------- “Connect Shopify” manual (sólo si no vino de Shopify) --------------- */
  connectBtn?.addEventListener('click', () => {
    let shop = qs.get('shop');
    let host = hostFromQuery;

    if (!shop || !host) {
      shop = prompt('Ingresa tu dominio (ej: mitienda.myshopify.com):');
      if (!shop?.endsWith('.myshopify.com')) return alert('Dominio inválido');
      host = btoa(`${shop}/admin`);
    }
    location.href = `/connector?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  });

  /* ------------- “Enviar dominio” (usa apiFetch en lugar de fetch) -------------- */
  domainSend?.addEventListener('click', async () => {
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    try {
      // 🚀 llamas al endpoint seguro con JWT
      const data = await apiFetch("/api/secure/shopify/match", {
        method: "POST",
        body: JSON.stringify({ shop }),
      });

      if (data.ok) {
        pintarShopifyConectado();
        domainStep.classList.add('step--hidden');
      } else {
        alert(data.error || 'No se pudo vincular la tienda.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al conectar con el servidor.');
    }
  });

  /* ----------------------- Google / Continue ----------------------- */
  connectGoogleBtn?.addEventListener('click', () => location.href = '/auth/google/connect');
  continueBtn?.addEventListener('click', () => location.href = '/');
});
