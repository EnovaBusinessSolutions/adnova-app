// public/connector/interface.connector.js
"use strict";

/**
 * ADRAY Shopify Connector (Embedded)
 *
 * App Bridge v4 (CDN-only):
 * - El <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="...">
 *   expone un global `shopify` ya inicializado.
 * - Token de sesión: `await shopify.idToken()`
 * - Navegación fuera del iframe: `window.open(url, '_top')` (App Bridge lo intercepta).
 *
 * Shopify PROHÍBE bundlear o self-hostear App Bridge (revisión automática cada 2h).
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const statusPill = $("statusPill");
  const kvShop     = $("kvShop");
  const kvHost     = $("kvHost");
  const errBox     = $("errBox");
  const btnReload  = $("btnReload");
  const btnGo      = $("btnGo");

  function setStatus(txt) {
    if (statusPill) statusPill.textContent = txt || "";
  }

  function showError(msg) {
    if (!errBox) return;
    errBox.style.display = "block";
    errBox.textContent = msg || "";
  }

  function hideError() {
    if (!errBox) return;
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  function getMeta(name) {
    const el = document.querySelector('meta[name="' + name + '"]');
    return el ? String(el.getAttribute("content") || "") : "";
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // Espera a que el global `shopify` (App Bridge v4) esté disponible.
  async function waitForShopifyGlobal(timeoutMs) {
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.shopify && typeof window.shopify.idToken === "function") {
        return window.shopify;
      }
      await sleep(60);
    }
    return null;
  }

  function saveSession(opts) {
    try {
      if (opts.token) {
        sessionStorage.setItem("sessionToken", opts.token);
        sessionStorage.setItem("shopifySessionToken", opts.token);
      }
      if (opts.shop) sessionStorage.setItem("shopifyShop", opts.shop);
      if (opts.host) sessionStorage.setItem("shopifyHost", opts.host);
      sessionStorage.setItem("shopifyConnected", "true");
    } catch (e) { /* ignore */ }
  }

  function setKV(shop, host) {
    if (kvShop) kvShop.textContent = shop || "—";
    if (kvHost) kvHost.textContent = host || "—";
  }

  // Navega fuera del iframe. Con App Bridge v4 cargado, `window.open(url, '_top')`
  // es el patrón oficial para redirects remotos (App Bridge lo intercepta).
  function navigateTo(url) {
    try {
      window.open(url, "_top");
      return;
    } catch (e) { /* fallback */ }
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e) {
      window.location.href = url;
    }
  }

  function enableCTA(shop, host, appUrl) {
    setStatus("Listo ✅");
    hideError();
    if (btnGo) {
      btnGo.disabled = false;
      btnGo.onclick = function () {
        var base = (appUrl || window.location.origin).replace(/\/$/, "");
        var url =
          base + "/onboarding?from=shopify" +
          "&shop=" + encodeURIComponent(shop) +
          "&host=" + encodeURIComponent(host);
        navigateTo(url);
      };
    }
  }

  // Verifica via endpoint ligero (no requiere JWT)
  async function pingConnector(shop) {
    var r = await fetch("/connector/ping?shop=" + encodeURIComponent(shop), {
      method: "GET",
      credentials: "include",
    });
    return r;
  }

  // Pide session token (JWT) via App Bridge v4. No bloquea la UI si falla.
  async function fetchSessionToken(shop, host) {
    try {
      var sh = await waitForShopifyGlobal(4000);
      if (!sh) return;
      var tok = await sh.idToken();
      if (tok) saveSession({ token: tok, shop: shop, host: host });
    } catch (e) { /* silencioso */ }
  }

  async function boot() {
    hideError();
    setStatus("Preparando…");

    var cfg     = window.__ADRAY_CONNECTOR__ || {};
    var shop    = String(cfg.shop   || "").trim();
    var host    = String(cfg.host   || "").trim();
    var appUrl  = String(cfg.appUrl || getMeta("app-url") || "").trim();
    var alreadyConnected = getMeta("shopify-connected") === "true";

    setKV(shop, host);

    if (!shop) {
      setStatus("Falta shop");
      showError('Missing "shop". Abre desde Shopify Admin (Apps).');
      return;
    }

    // ✅ Ruta rápida: backend ya confirmó conexión al servir el HTML
    if (alreadyConnected) {
      enableCTA(shop, host, appUrl);
      // Obtener session token en background (no bloquea el CTA)
      fetchSessionToken(shop, host);
      return;
    }

    // ✅ Fallback: verificar via /connector/ping (no requiere JWT)
    setStatus("Verificando conexión…");
    try {
      var pingRes = await pingConnector(shop);
      if (pingRes.ok) {
        saveSession({ shop: shop, host: host });
        enableCTA(shop, host, appUrl);
        fetchSessionToken(shop, host);
        return;
      }
    } catch (e) { /* si el ping falla de red, continuamos */ }

    // ✅ Si no está conectado aún, mostrar estado de pendiente (OAuth ya debería haber corrido)
    setStatus("Sin conexión");
    showError(
      "Esta tienda aún no completó la instalación.\n" +
      "Desinstala y vuelve a instalar la app desde Shopify Admin."
    );
  }

  if (btnReload) btnReload.onclick = function () { window.location.reload(); };

  boot().catch(function (e) {
    setStatus("Error");
    showError((e && e.stack) || (e && e.message) || String(e));
  });
})();
