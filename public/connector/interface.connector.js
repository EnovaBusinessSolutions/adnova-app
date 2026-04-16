// public/connector/interface.connector.js
"use strict";

/**
 * ADRAY Shopify Connector (Embedded)
 * - Usa App Bridge UMD self-host ( /connector/vendor/app-bridge.umd.js )
 * - Usa App Bridge Utils UMD self-host ( /connector/vendor/app-bridge-utils.umd.js )
 * - Genera Session Token con getSessionToken(app)
 * - Valida token contra backend: GET /api/secure/ping (Authorization: Bearer <token>)
 * - Guarda token en sessionStorage y habilita CTA a /onboarding (top-level)
 */

(function () {
  const $ = (id) => document.getElementById(id);

  const statusPill = $("statusPill");
  const kvShop = $("kvShop");
  const kvHost = $("kvHost");
  const errBox = $("errBox");
  const btnReload = $("btnReload");
  const btnGo = $("btnGo");

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
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? String(el.getAttribute("content") || "") : "";
  }

  function topNavigate(url) {
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      window.location.href = url;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ✅ Detectores robustos de UMD globals (dependiendo del build, cambia el nombre)
  function getCreateAppFn() {
    // Comunes:
    // - window["app-bridge"].default
    // - window.appBridge.default
    // - window.AppBridge (menos común)
    const ab =
      window["app-bridge"] ||
      window.appBridge ||
      window.AppBridge ||
      null;

    if (!ab) return null;

    // En UMD de Shopify normalmente viene como default export
    const createApp = ab.default || ab.createApp || null;
    return typeof createApp === "function" ? createApp : null;
  }

  function getGetSessionTokenFn() {
    const u =
      window["app-bridge-utils"] ||
      window.appBridgeUtils ||
      window.AppBridgeUtils ||
      null;

    if (!u) return null;

    const fn = u.getSessionToken || null;
    return typeof fn === "function" ? fn : null;
  }

  async function waitForUmdGlobals(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const createApp = getCreateAppFn();
      const getSessionToken = getGetSessionTokenFn();
      if (createApp && getSessionToken) return { createApp, getSessionToken };
      await sleep(60);
    }
    return { createApp: null, getSessionToken: null };
  }

  async function pingBackend(token) {
    // Requiere verifySessionToken en backend
    const r = await fetch("/api/secure/ping", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    return r;
  }

  function saveSession({ token, shop, host }) {
    try {
      if (token) {
        sessionStorage.setItem("sessionToken", token);         // compat general
        sessionStorage.setItem("shopifySessionToken", token);  // compat conector
      }
      if (shop) sessionStorage.setItem("shopifyShop", shop);
      if (host) sessionStorage.setItem("shopifyHost", host);
      sessionStorage.setItem("shopifyConnected", "true");
    } catch {
      // ignore
    }
  }

  function setKV(shop, host) {
    if (kvShop) kvShop.textContent = shop || "—";
    if (kvHost) kvHost.textContent = host || "—";
  }

  function enableCTA(shop, host, appUrl) {
    setStatus("Listo ✅");
    hideError();
    if (btnGo) {
      btnGo.disabled = false;
      btnGo.onclick = () => {
        const base = (appUrl || window.location.origin).replace(/\/$/, "");
        const url =
          `${base}/onboarding?from=shopify` +
          `&shop=${encodeURIComponent(shop)}` +
          `&host=${encodeURIComponent(host)}`;
        topNavigate(url);
      };
    }
  }

  async function boot() {
    hideError();
    setStatus("Preparando…");

    const cfg = window.__ADRAY_CONNECTOR__ || {};
    const shop = String(cfg.shop || "").trim();
    const host = String(cfg.host || "").trim();
    const apiKey = String(cfg.apiKey || getMeta("shopify-api-key") || "").trim();
    const appUrl = String(cfg.appUrl || getMeta("app-url") || "").trim();
    const alreadyConnected = getMeta("shopify-connected") === "true";

    setKV(shop, host);

    // ✅ Si el backend ya confirmó que hay token OAuth, habilitamos el CTA de inmediato.
    // Seguimos intentando obtener el session token en segundo plano para actualizar sessionStorage.
    if (alreadyConnected && shop) {
      enableCTA(shop, host, appUrl);
      // Refresco silencioso de session token (no bloquea UI)
      (async () => {
        try {
          const { createApp, getSessionToken } = await waitForUmdGlobals(9000);
          if (createApp && getSessionToken && apiKey && host) {
            const app = createApp({ apiKey, host, forceRedirect: false });
            const token = await getSessionToken(app);
            if (token) saveSession({ token, shop, host });
          }
        } catch { /* silent */ }
      })();
      return;
    }

    if (!apiKey || apiKey.includes("{") || apiKey.includes("}")) {
      setStatus("API key inválida");
      showError(
        'No se encontró una "shopify-api-key" válida.\n' +
          "Verifica que /connector/interface inyecte {{SHOPIFY_API_KEY}}."
      );
      return;
    }

    if (!shop) {
      setStatus("Falta shop");
      showError('Missing "shop".\nAbre esta pantalla desde Shopify Admin (Apps).');
      return;
    }

    if (!host) {
      setStatus("Falta host");
      showError(
        'Missing "host".\nApp Bridge embedded requiere host. Revisa que /apps/<handle> redirija con host.'
      );
      return;
    }

    setStatus("Cargando App Bridge…");

    const { createApp, getSessionToken } = await waitForUmdGlobals(9000);
    if (!createApp || !getSessionToken) {
      setStatus("Error App Bridge");
      showError(
        "No se detectaron los UMD globals de App Bridge.\n\n" +
          "Verifica que estén cargando (Network → filtro vendor):\n" +
          "- /connector/vendor/app-bridge.umd.js\n" +
          "- /connector/vendor/app-bridge-utils.umd.js\n\n" +
          "Y que ambos estén en status 200."
      );
      return;
    }

    setStatus("Inicializando…");
    let app;
    try {
      // ✅ createApp requiere apiKey + host
      app = createApp({ apiKey, host, forceRedirect: true });
    } catch (e) {
      setStatus("Error App Bridge");
      showError("Fallo inicializando App Bridge.\n" + (e?.message || String(e)));
      return;
    }

    setStatus("Obteniendo Session Token…");
    let token = null;
    try {
      token = await getSessionToken(app);
      if (!token || typeof token !== "string") throw new Error("Token vacío");
    } catch (e) {
      setStatus("Token falló");
      showError("No se pudo obtener Session Token.\n" + (e?.message || String(e)));
      return;
    }

    setStatus("Verificando sesión…");
    let pingRes;
    let bodyTxt = "";
    try {
      pingRes = await pingBackend(token);
      bodyTxt = await pingRes.text();
    } catch (e) {
      setStatus("Error backend");
      showError("No se pudo conectar al backend.\n" + (e?.message || String(e)));
      return;
    }

    if (!pingRes.ok) {
      setStatus("Auth falló");
      showError(`Ping /api/secure/ping falló (${pingRes.status}).\n${bodyTxt || ""}`);
      return;
    }

    // ✅ Si backend aceptó, guardamos token y habilitamos CTA
    saveSession({ token, shop, host });
    enableCTA(shop, host, appUrl);
  }

  if (btnReload) btnReload.onclick = () => window.location.reload();

  boot().catch((e) => {
    setStatus("Error");
    showError(e?.stack || e?.message || String(e));
  });
})();