(function () {
  const $ = (id) => document.getElementById(id);

  const pill = $("statusPill");
  const errBox = $("errBox");
  const kvShop = $("kvShop");
  const kvHost = $("kvHost");
  const btnGo = $("btnGo");
  const btnReload = $("btnReload");

  function setStatus(txt) {
    if (pill) pill.textContent = txt;
  }

  function showErr(e) {
    if (!errBox) return;
    errBox.style.display = "block";
    errBox.textContent =
      typeof e === "string"
        ? e
        : (e && (e.stack || e.message))
          ? (e.stack || e.message)
          : String(e);
  }

  function hideErr() {
    if (!errBox) return;
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  function getApiKey() {
    const meta = document.querySelector('meta[name="shopify-api-key"]');
    const key = meta && meta.content ? meta.content.trim() : "";
    return key;
  }

  function getParams() {
    const qs = new URL(location.href).searchParams;
    const shop = (qs.get("shop") || "").trim();
    const host = (qs.get("host") || "").trim();
    return { shop, host };
  }

  function waitForAppBridge(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      (function tick() {
        // UMD global: window['app-bridge']
        const AB = window["app-bridge"];
        if (AB && typeof AB.createApp === "function" && AB.actions) return resolve(AB);
        if (Date.now() - started > timeoutMs) return reject(new Error("App Bridge no se cargó a tiempo."));
        requestAnimationFrame(tick);
      })();
    });
  }

  async function init() {
    setStatus("Validando parámetros…");

    const { shop, host } = getParams();
    if (kvShop) kvShop.textContent = shop || "—";
    if (kvHost) kvHost.textContent = host || "—";

    if (!shop || !host) {
      setStatus("Faltan parámetros");
      throw new Error(
        "Faltan query params requeridos.\n\nSe requiere: ?shop=...&host=...\n\nTip: abre esta vista desde Shopify Admin, no directo."
      );
    }

    const apiKey = getApiKey();
    if (!apiKey || apiKey === "SHOPIFY_API_KEY") {
      setStatus("Falta API Key");
      throw new Error(
        'No se encontró una API Key válida en <meta name="shopify-api-key" ...>.\n\nAsegúrate de renderizarla desde backend.'
      );
    }

    setStatus("Cargando App Bridge…");
    const AB = await waitForAppBridge();

    setStatus("Inicializando…");
    const app = AB.createApp({
      apiKey,
      host,
      forceRedirect: true
    });

    const { SessionToken, Redirect } = AB.actions;

    async function getSessionTokenOnce() {
      return new Promise((resolve, reject) => {
        let unsub = null;

        const timer = setTimeout(() => {
          try { unsub && unsub(); } catch (_) {}
          reject(new Error("Timeout obteniendo session token."));
        }, 12000);

        try {
          unsub = app.subscribe(SessionToken.Action.RESPOND, (payload) => {
            clearTimeout(timer);
            try { unsub && unsub(); } catch (_) {}

            const token = payload && payload.sessionToken;
            if (!token) return reject(new Error("Shopify respondió sin sessionToken."));
            resolve(token);
          });

          app.dispatch(SessionToken.request());
        } catch (err) {
          clearTimeout(timer);
          try { unsub && unsub(); } catch (_) {}
          reject(err);
        }
      });
    }

    btnReload?.addEventListener("click", () => location.reload());

    btnGo?.addEventListener("click", async () => {
      hideErr();
      btnGo.disabled = true;
      setStatus("Generando session token…");

      try {
        const token = await getSessionTokenOnce();

        // Guardar para que /onboarding lo lea (sin exponer en URL)
        sessionStorage.setItem("shopifyConnected", "true");
        sessionStorage.setItem("shopifyShop", shop);
        sessionStorage.setItem("shopifyHost", host);
        sessionStorage.setItem("sessionToken", token);

        setStatus("Listo. Redirigiendo…");

        // Importante: salir del iframe (top-level) usando App Bridge
        const redirect = Redirect.create(app);
        redirect.dispatch(Redirect.Action.REMOTE, "/onboarding");
      } catch (e) {
        setStatus("Error");
        showErr(e);
        btnGo.disabled = false;
      }
    });

    setStatus("Listo");
  }

  function boot() {
    init().catch((e) => {
      setStatus("Error");
      showErr(e);
      if (btnGo) btnGo.disabled = false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
