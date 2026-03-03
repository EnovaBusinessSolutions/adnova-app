// public/connector/interface.connector.js

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

  async function waitForShopifyGlobal(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.shopify && typeof window.shopify === "object") return true;
      await sleep(50);
    }
    return false;
  }

  function withTimeout(promise, ms, label = "timeout") {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label)), ms);
      Promise.resolve(promise)
        .then((v) => {
          clearTimeout(t);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });
  }

  async function getSessionTokenSafe() {
    if (!window.shopify || typeof window.shopify !== "object") {
      throw new Error("window.shopify no disponible.");
    }
    if (typeof window.shopify.idToken !== "function") {
      throw new Error("shopify.idToken() no disponible en este entorno.");
    }
    const token = await withTimeout(window.shopify.idToken(), 7000, "idToken_timeout");
    if (!token || typeof token !== "string") {
      throw new Error("idToken() regresó vacío.");
    }
    return token;
  }


  async function pingBackend({ token }) {
    // 1) Con Bearer
    if (token) {
      const r = await fetch("/api/secure/ping", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });
      return r;
    }

    // 2) Sin header (fallback)
    const r2 = await fetch("/api/secure/ping", {
      method: "GET",
      credentials: "include",
    });
    return r2;
  }

  function saveSession({ token, shop, host }) {
    try {
      if (token) {
        // compat: algunos módulos esperan "sessionToken"
        sessionStorage.setItem("sessionToken", token);
        sessionStorage.setItem("shopifySessionToken", token);
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

  async function boot() {
    hideError();
    setStatus("Preparando…");

    const cfg = window.__ADRAY_CONNECTOR__ || {};
    const shop = String(cfg.shop || "").trim();
    const host = String(cfg.host || "").trim();
    const apiKey = String(cfg.apiKey || getMeta("shopify-api-key") || "").trim();
    const appUrl = String(cfg.appUrl || getMeta("app-url") || "").trim();

    setKV(shop, host);

    if (!apiKey || apiKey.includes("{") || apiKey.includes("}")) {
      setStatus("API key inválida");
      showError(
        'No se encontró una "shopify-api-key" válida.\nVerifica que /connector/interface inyecte {{SHOPIFY_API_KEY}}.'
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

    const ok = await waitForShopifyGlobal();
    if (!ok) {
      setStatus("Error App Bridge");
      showError(
        "No cargó window.shopify (app-bridge.js).\nRevisa CSP / red / adblockers."
      );
      return;
    }

  
    setStatus("Obteniendo Session Token…");

    let token = null;
    let tokenWarning = "";

    // Intento principal: shopify.idToken()
    try {
      token = await getSessionTokenSafe();
    } catch (e) {
      // No bloqueamos; intentaremos ping sin token (auto-auth) para detectar si App Bridge ya inyecta headers
      tokenWarning =
        "No se pudo obtener idToken(). Continuaré con verificación por fetch.\n" +
        (e?.message || String(e));
      console.warn("[connector] idToken() failed:", e);
    }

    setStatus("Verificando sesión…");

    let pingRes = null;
    try {
      pingRes = await pingBackend({ token });
    } catch (e) {
      setStatus("Error backend");
      showError(
        "No se pudo conectar al backend para verificar sesión.\n" +
          (e?.message || String(e))
      );
      return;
    }

    if (!pingRes || !pingRes.ok) {
      const code = pingRes ? `${pingRes.status}` : "NO_RESPONSE";
      let body = "";
      try {
        body = pingRes ? await pingRes.text() : "";
      } catch {}

      setStatus("Auth falló");
      showError(
        `Ping a /api/secure/ping falló (${code}).\n` +
          (body ? body.slice(0, 600) + (body.length > 600 ? "…" : "") + "\n" : "") +
          (tokenWarning ? "\n---\n" + tokenWarning : "")
      );
      return;
    }

    // Si el backend aceptó, guardamos lo que tengamos.
    saveSession({ token, shop, host });

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

  if (btnReload) btnReload.onclick = () => window.location.reload();

  boot().catch((e) => {
    setStatus("Error");
    showError(e?.stack || e?.message || String(e));
  });
})();