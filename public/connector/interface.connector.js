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
    // romper iframe (necesita interacción del usuario para algunos navegadores)
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

  async function getSessionToken(app) {
    // Preferido (más simple). Si no existe, lanzamos error.
    if (app && typeof app.idToken === 'function') {
      return await app.idToken();
    }
    throw new Error('App Bridge no expuso app.idToken().');
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
      // En admin.shopify.com el host es crítico para App Bridge.
      setStatus('Falta host');
      showError(
        'Missing "host".\n\nEsto normalmente significa que no entraste desde el Admin de Shopify (embedded).\nReinstala/abre la app desde Shopify Admin para que Shopify agregue ?host=...'
      );
      return;
    }

    const apiKey = (getMeta('shopify-api-key') || '').trim();
    if (!apiKey) {
      setStatus('Falta API key');
      showError('Missing meta shopify-api-key. Revisa interface.html o el backend que lo inyecta.');
      return;
    }

    setStatus('Cargando App Bridge…');

    const ok = await waitForAppBridge();
    if (!ok) {
      setStatus('Error App Bridge');
      showError('App Bridge no cargó. Revisa CSP (shopifyCSP) y el script de Shopify.');
      return;
    }

    let app;
    try {
      const AppBridge = window['app-bridge'];
      const createApp = AppBridge.default;

      app = createApp({
        apiKey,
        host,
        forceRedirect: true, // Shopify recomienda forzar redirección top-level cuando aplica
      });
    } catch (e) {
      setStatus('Error init');
      showError('No se pudo inicializar App Bridge.\n' + (e?.message || e));
      return;
    }

    setStatus('Generando Session Token…');

    // Reintentos: a veces el primer intento falla justo al cargar en embedded
    let token = null;
    let lastErr = null;
    for (let i = 0; i < 4; i++) {
      try {
        token = await getSessionToken(app);
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
    btnGo.disabled = false;

    btnGo.addEventListener('click', () => {
      // Enviar a onboarding SAAS (fuera de iframe)
      const base = (getMeta('app-url') || window.location.origin).replace(/\/$/, '');
      const url = `${base}/onboarding?from=shopify&shop=${encodeURIComponent(shop)}`;
      topNavigate(url);
    });
  }

  btnReload?.addEventListener('click', () => window.location.reload());

  // arranque
  boot().catch((e) => {
    setStatus('Error');
    showError(e?.stack || e?.message || String(e));
  });
})();
