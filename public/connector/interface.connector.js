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
    return el ? el.getAttribute('content') : '';
  }

  function topNavigate(url) {
    try {
      if (window.top) window.top.location.href = url;
      else window.location.href = url;
    } catch (e) {
      window.location.href = url;
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForAppBridge(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window['app-bridge'] && window['app-bridge'].default) return true;
      await sleep(50);
    }
    return false;
  }

  async function tryGetSessionToken(app) {
    // 1) Si existe idToken() (algunas variantes)
    if (app && typeof app.idToken === 'function') {
      return await app.idToken();
    }

    // 2) Si agregas app-bridge-utils (opcional), úsalo:
    const utils = window['app-bridge-utils'];
    if (utils && typeof utils.getSessionToken === 'function') {
      return await utils.getSessionToken(app);
    }

    throw new Error(
      'No se pudo obtener Session Token. Falta app.idToken() y no está cargado app-bridge-utils (getSessionToken).'
    );
  }

  async function boot() {
    hideError();
    setStatus('Leyendo parámetros…');

    const p = qs();
    const shop = (p.get('shop') || '').trim();
    const host = (p.get('host') || '').trim();

    kvShop.textContent = shop || '—';
    kvHost.textContent = host || '—';

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
        'Missing "host".\n\nEsto normalmente significa que no entraste desde Shopify Admin (embedded).\nAbre la app desde Shopify Admin para que Shopify agregue ?host=...'
      );
      return;
    }

    const apiKey = (getMeta('shopify-api-key') || '').trim();
    if (!apiKey || apiKey.includes('{') || apiKey.includes('}')) {
      setStatus('API key inválida');
      showError(
        'shopify-api-key inválida.\n\nAsegúrate que el meta shopify-api-key tenga la API Key real (sin {{ }}).'
      );
      return;
    }

    setStatus('Cargando App Bridge…');

    const ok = await waitForAppBridge();
    if (!ok) {
      setStatus('Error App Bridge');
      showError('App Bridge no cargó. Revisa CSP (shopifyCSP) y el script oficial.');
      return;
    }

    let app;
    try {
      const AppBridge = window['app-bridge'];
      const createApp = AppBridge.default;

      const inIframe = (window.top !== window.self);

      app = createApp({
        apiKey,
        host,
        forceRedirect: !inIframe, // ✅ solo si se abre fuera del iframe
      });
    } catch (e) {
      setStatus('Error init');
      showError('No se pudo inicializar App Bridge.\n' + (e?.message || e));
      return;
    }

    setStatus('Generando Session Token…');

    let token = null;
    let lastErr = null;

    for (let i = 0; i < 4; i++) {
      try {
        token = await tryGetSessionToken(app);
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

    sessionStorage.setItem('shopifyShop', shop);
    sessionStorage.setItem('shopifyHost', host);
    sessionStorage.setItem('shopifyConnected', 'true');

    setStatus('Listo ✅');
    btnGo.disabled = false;

    btnGo.addEventListener('click', () => {
      const base = (getMeta('app-url') || window.location.origin).replace(/\/$/, '');
      const url = `${base}/onboarding?from=shopify&shop=${encodeURIComponent(shop)}`;
      topNavigate(url);
    });
  }

  btnReload?.addEventListener('click', () => window.location.reload());

  boot().catch((e) => {
    setStatus('Error');
    showError(e?.stack || e?.message || String(e));
  });
})();
