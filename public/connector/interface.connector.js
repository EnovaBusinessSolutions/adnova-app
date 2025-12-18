// public/connector/interface.connector.js
(function () {
  const $ = (id) => document.getElementById(id);

  const statusPill = $('statusPill');
  const kvShop = $('kvShop');
  const kvHost = $('kvHost');
  const errBox = $('errBox');
  const btnReload = $('btnReload');
  const btnGo = $('btnGo');

  function setStatus(txt) {
    if (statusPill) statusPill.textContent = txt;
  }

  function showError(msg) {
    if (!errBox) return;
    errBox.style.display = 'block';
    errBox.textContent = msg;
  }

  function hideError() {
    if (!errBox) return;
    errBox.style.display = 'none';
    errBox.textContent = '';
  }

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? (el.getAttribute('content') || '') : '';
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isIframe() {
    try {
      return window.top && window.top !== window.self;
    } catch (_) {
      return true;
    }
  }

  async function waitForBridge(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const AB = window['app-bridge'];
      const ABU = window['app-bridge-utils'];
      if (AB && AB.default && AB.actions && ABU && typeof ABU.getSessionToken === 'function') {
        return true;
      }
      await sleep(50);
    }
    return false;
  }

  async function getToken(app) {
    const ABU = window['app-bridge-utils'];
    if (ABU && typeof ABU.getSessionToken === 'function') {
      return await ABU.getSessionToken(app);
    }
    // fallback (por si utils no carga por alguna razón)
    if (app && typeof app.idToken === 'function') {
      return await app.idToken();
    }
    throw new Error('No existe getSessionToken(app). Revisa que cargaste app-bridge-utils.js.');
  }

  function redirectRemote(app, url) {
    try {
      const AB = window['app-bridge'];
      const Redirect = AB.actions.Redirect;
      const redirect = Redirect.create(app);
      redirect.dispatch(Redirect.Action.REMOTE, url);
      return true;
    } catch (e) {
      return false;
    }
  }

  function topNavigate(url) {
    try {
      if (window.top) window.top.location.href = url;
      else window.location.href = url;
    } catch (e) {
      window.location.href = url;
    }
  }

  async function boot() {
    hideError();
    setStatus('Leyendo parámetros…');

    const p = qs();
    const shop = (p.get('shop') || '').trim();
    const host = (p.get('host') || '').trim();

    if (kvShop) kvShop.textContent = shop || '—';
    if (kvHost) kvHost.textContent = host || '—';

    if (!shop) {
      setStatus('Falta shop');
      showError(
        'Missing "shop".\n\nAbre esta pantalla desde el Admin de Shopify (Apps) o instala la app desde el App Store.'
      );
      return;
    }

    if (!host) {
      setStatus('Falta host');
      showError(
        'Missing "host".\n\nEsto normalmente significa que no entraste desde el Admin de Shopify (embedded).\nAbre la app desde Shopify Admin para que Shopify agregue ?host=...'
      );
      return;
    }

    const apiKey = (getMeta('shopify-api-key') || '').trim();
    if (!apiKey || apiKey.includes('{{')) {
      setStatus('Falta API key');
      showError(
        'Missing meta shopify-api-key.\n\nSi estás usando placeholders, asegúrate que /connector/interface los inyecta antes de responder.'
      );
      return;
    }

    setStatus('Cargando App Bridge…');

    const ok = await waitForBridge();
    if (!ok) {
      setStatus('Error App Bridge');
      showError(
        'App Bridge o app-bridge-utils no cargó.\n\nRevisa que interface.html incluya:\n- https://cdn.shopify.com/shopifycloud/app-bridge.js\n- https://cdn.shopify.com/shopifycloud/app-bridge-utils.js\n\nY revisa CSP (shopifyCSP).'
      );
      return;
    }

    let app;
    try {
      const AppBridge = window['app-bridge'];
      const createApp = AppBridge.default;

      // ✅ NO forceRedirect aquí (evitamos auto-saltos “grises”)
      app = createApp({ apiKey, host });
    } catch (e) {
      setStatus('Error init');
      showError('No se pudo inicializar App Bridge.\n' + (e?.message || e));
      return;
    }

    setStatus('Generando Session Token…');

    let token = null;
    let lastErr = null;

    for (let i = 0; i < 5; i++) {
      try {
        token = await getToken(app);
        if (token) break;
      } catch (e) {
        lastErr = e;
        await sleep(250 + i * 250);
      }
    }

    if (!token) {
      setStatus('Token falló');
      showError(
        'No se pudo obtener Session Token.\n' +
          (lastErr?.message || String(lastErr || '')) +
          '\n\nTip: confirma que abriste la app desde Shopify Admin (embedded) y que viene ?host=...'
      );
      return;
    }

    // Guardar en sessionStorage (NO URL)
    sessionStorage.setItem('shopifySessionToken', token);
    sessionStorage.setItem('shopifyShop', shop);
    sessionStorage.setItem('shopifyHost', host);
    sessionStorage.setItem('shopifyConnected', 'true');

    setStatus('Listo ✅');
    if (btnGo) btnGo.disabled = false;

    if (btnGo) {
      btnGo.addEventListener('click', () => {
        // ✅ URL final SAAS
        const base = (getMeta('app-url') || window.location.origin).replace(/\/$/, '');
        const url = `${base}/onboarding?from=shopify&shop=${encodeURIComponent(shop)}`;

        // ✅ Primero intenta Redirect REMOTE (más confiable dentro de iframe)
        const used = redirectRemote(app, url);

        // fallback por si algo bloquea actions (raro)
        if (!used) topNavigate(url);
      });
    }

    // UX: si está embebido, avisar que el botón hará el escape
    if (isIframe()) {
      // opcional, no hace nada visual si no quieres
    }
  }

  if (btnReload) btnReload.addEventListener('click', () => window.location.reload());

  boot().catch((e) => {
    setStatus('Error');
    showError(e?.stack || e?.message || String(e));
  });
})();
