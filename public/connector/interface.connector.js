// public/connector/interface.connector.js
"use strict";

/**
 * ADRAY Shopify Connector (Embedded)
 * - Si el backend ya marcó CONNECTED=true (meta tag), habilita CTA inmediatamente.
 * - Fallback: verifica via GET /connector/ping?shop= (no requiere JWT).
 * - Usa App Bridge Redirect para navegación embedded dentro de Shopify admin.
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

  function getCreateAppFn() {
    var ab = window["app-bridge"] || window.appBridge || window.AppBridge || null;
    if (!ab) return null;
    var fn = ab.default || ab.createApp || null;
    return typeof fn === "function" ? fn : null;
  }

  function getGetSessionTokenFn() {
    var u = window["app-bridge-utils"] || window.appBridgeUtils || window.AppBridgeUtils || null;
    if (!u) return null;
    var fn = u.getSessionToken || null;
    return typeof fn === "function" ? fn : null;
  }

  function getRedirectFn() {
    var ab = window["app-bridge"] || window.appBridge || window.AppBridge || null;
    if (!ab) return null;
    // App Bridge v2 exposes actions.Redirect
    var actions = ab.actions || (ab.default && ab.default.actions) || null;
    if (actions && actions.Redirect) return actions.Redirect;
    return null;
  }

  async function waitForUmdGlobals(timeoutMs) {
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      var createApp = getCreateAppFn();
      var getSessionToken = getGetSessionTokenFn();
      if (createApp && getSessionToken) return { createApp: createApp, getSessionToken: getSessionToken };
      await sleep(60);
    }
    return { createApp: null, getSessionToken: null };
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

  // ✅ Navegar usando App Bridge Redirect (embedded) o window.top como fallback
  function navigateTo(app, url) {
    try {
      var Redirect = getRedirectFn();
      if (app && Redirect) {
        var redirect = Redirect.create(app);
        redirect.dispatch(Redirect.Action.REMOTE, url);
        return;
      }
    } catch (e) { /* fall through */ }
    // Fallback: salir del iframe hacia el destino
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

  function enableCTA(shop, host, appUrl, app) {
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
        navigateTo(app, url);
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

  async function boot() {
    hideError();
    setStatus("Preparando…");

    var cfg     = window.__ADRAY_CONNECTOR__ || {};
    var shop    = String(cfg.shop   || "").trim();
    var host    = String(cfg.host   || "").trim();
    var apiKey  = String(cfg.apiKey || getMeta("shopify-api-key") || "").trim();
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
      // Habilitar CTA INMEDIATAMENTE, sin esperar App Bridge
      enableCTA(shop, host, appUrl, null);
      // Inicializar App Bridge en background para mejorar navegación (no bloquea)
      (async function () {
        try {
          var globs = await waitForUmdGlobals(4000);
          if (globs.createApp && apiKey && host) {
            var appInst = globs.createApp({ apiKey: apiKey, host: host, forceRedirect: false });
            if (globs.getSessionToken) {
              var tok = await globs.getSessionToken(appInst);
              if (tok) saveSession({ token: tok, shop: shop, host: host });
            }
            // Actualizar el onclick con instancia real de App Bridge
            enableCTA(shop, host, appUrl, appInst);
          }
        } catch (e) { /* silent */ }
      })();
      return;
    }

    // ✅ Fallback: verificar via /connector/ping (no requiere JWT)
    setStatus("Verificando conexión…");
    try {
      var pingRes = await pingConnector(shop);
      if (pingRes.ok) {
        saveSession({ shop: shop, host: host });
        var appInst2 = null;
        try {
          var globs2 = await waitForUmdGlobals(4000);
          if (globs2.createApp && apiKey && host) {
            appInst2 = globs2.createApp({ apiKey: apiKey, host: host, forceRedirect: false });
            if (globs2.getSessionToken) {
              var tok2 = await globs2.getSessionToken(appInst2);
              if (tok2) saveSession({ token: tok2, shop: shop, host: host });
            }
          }
        } catch (e) { /* silent */ }
        enableCTA(shop, host, appUrl, appInst2);
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
