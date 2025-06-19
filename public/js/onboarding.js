// public/js/onboarding.js

import { apiFetch } from "./apiFetch.js";
import { app } from "./appBridgeInit.js";  // app ya inicializado con el App Bridge global

document.addEventListener('DOMContentLoaded', async () => {
  const qs            = new URLSearchParams(location.search);
  const shopFromQuery = qs.get('shop');
  const hostFromQuery = qs.get('host');

  const connectBtn       = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn = document.getElementById('connect-google-btn');
  const continueBtn      = document.getElementById('continue-btn');
  const flagShopify      = document.getElementById('shopifyConnectedFlag');
  const flagGoogle       = document.getElementById('googleConnectedFlag');
  const domainStep       = document.getElementById('shopify-domain-step');
  const domainInput      = document.getElementById('shop-domain-input');
  const domainSend       = document.getElementById('shop-domain-send');

  // 1️⃣ Prueba para Shopify checker: dispara un XHR con JWT
  try {
    const pingRes = await apiFetch("/api/secure/ping");
    console.log("✅ PING OK:", pingRes);
  } catch (err) {
    console.error("❌ PING FAIL:", err);
  }

  // 2️⃣ Si venimos de /connector/interface?shop=... activamos el paso de dominio
  if (shopFromQuery) {
    domainStep.classList.remove('step--hidden');
    domainInput.value = shopFromQuery;
    domainInput.focus();
  }

  // Funciones para actualizar estado de botones
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

  // Estado inicial de los flags
  if (flagShopify.textContent.trim() === 'true') pintarShopifyConectado();
  if (flagGoogle.textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  // “Connect Shopify” manual (solo si no viene de Shopify)
  connectBtn?.addEventListener('click', () => {
    let shop = shopFromQuery;
    let host = hostFromQuery;

    if (!shop || !host) {
      shop = prompt('Ingresa tu dominio (ej: mitienda.myshopify.com):');
      if (!shop?.endsWith('.myshopify.com')) return alert('Dominio inválido');
      host = btoa(`${shop}/admin`);
    }
    location.href = `/connector?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  });

  // “Enviar dominio” usa apiFetch para incluir JWT
  domainSend?.addEventListener('click', async () => {
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    try {
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

  // “Connect Google” y “Continue”
  connectGoogleBtn?.addEventListener('click', () => {
    location.href = '/auth/google/connect';
  });
  continueBtn?.addEventListener('click', () => {
    location.href = '/';
  });
});
