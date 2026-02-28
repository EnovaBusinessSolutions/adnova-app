// public/connector/interface.connector.js
/*
  Reescrito completamente para usar App Bridge v4 exclusivamente via CDN (window.shopify).
  Elimina dependencias de @shopify/app-bridge (NPM) y su lógica de inicialización manual.
*/

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
      if (window.top && window.top !== window.self) {
         window.top.location.href = url;
      } else {
         window.location.href = url;
      }
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
      if (window.shopify && window.shopify.config) return true;
      await sleep(50);
    }
    return false;
  }

  async function getSessionToken() {
    // En App Bridge v4, obtenemos el token con shopify.idToken()
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      return await window.shopify.idToken();
    }
    throw new Error('App Bridge v4 idToken() not available (window.shopify missing or disconnected).');
  }

  async function boot() {
    hideError();
    setStatus('Leyendo parámetros…');

    const p = qs();
    const shop = (p.get('shop') || '').trim();
    const host = (p.get('host') || '').trim();

    if (kvShop) kvShop.textContent = shop || '—';
    if (kvHost) kvHost.textContent = host || '—';

    // 1. Validar parámetros básicos
    if (!shop) {
      setStatus('Falta shop');
      showError('Missing "shop".\nAbre esta pantalla desde el Admin de Shopify (Apps).');
      return;
    }
    // Host es obligatorio para App Bridge en modo embedded
    if (!host) {
      setStatus('Falta host');
      showError('Missing "host".\nEsto normalmente significa que no entraste desde Shopify Admin (embedded).');
      return;
    }

    const apiKey = (getMeta('shopify-api-key') || '').trim();
    if (!apiKey || apiKey.includes('{') || apiKey.includes('}')) {
      setStatus('API key inválida');
      showError('shopify-api-key inválida/missing en meta tags.');
      return;
    }

    setStatus('Cargando App Bridge…');

    const ok = await waitForAppBridge();
    if (!ok) {
        // Fallback or verify if script loaded
        setStatus('Error App Bridge');
        showError('No cargó window.shopify (CDN v4). Revisa conexión/CSP.');
        return;
    }

    // 2. Configurar App Bridge v4
    // Normalmente v4 auto-detecta params de la URL si coinciden, pero forzamos config
    try {
      shopify.config({
        apiKey: apiKey,
        shop: shop,
        forceRedirect: false, 
      });
    } catch (e) {
      console.error(e);
      setStatus('Error Config');
      showError('Fallo en shopify.config(): ' + e.message);
      return;
    }

    setStatus('Generando Session Token…');

    let token = null;
    let lastErr = null;

    // Retry loop para obtener token (a veces tarda en inicializar interno)
    for (let i = 0; i < 5; i++) {
        try {
            token = await getSessionToken();
            if (token) break;
        } catch (e) {
            lastErr = e;
            await sleep(500);
        }
    }

    if (!token) {
      setStatus('Token fallo');
      showError(
        'No se pudo obtener idToken.\n' + (lastErr?.message || String(lastErr))
      );
      return;
    }

    // 3. Verify session token against backend (Strict Mode)
    // Esto es lo que exige Shopify: validar la integridad del token en el servidor
    setStatus('Verificando sesión...');
    
    const pingBackend = async () => {
      try {
        // Siempre pedimos un token fresco antes de enviarlo
        const activeToken = await window.shopify.idToken(); 
        await fetch('/api/secure/ping', {
          method: 'GET',
          headers: { 
             'Authorization': `Bearer ${activeToken}`,
             'Content-Type': 'application/json'
          },
        });
      } catch (e) {
        console.warn('Ping backend failed', e);
      }
    };
    
    // Primer ping para validar que el token funciona
    await pingBackend();
    
    // Podemos guardar cosas en Session Storage para uso posterior
    sessionStorage.setItem('shopifySessionToken', token);
    sessionStorage.setItem('shopifyShop', shop);
    sessionStorage.setItem('shopifyHost', host);
    sessionStorage.setItem('shopifyConnected', 'true');

    // UI Ready
    setStatus('Listo ✅');
    if (btnGo) {
        btnGo.disabled = false;
        btnGo.onclick = () => {
            const base = (getMeta('app-url') || window.location.origin).replace(/\/$/, '');
            // Construir URL destino
            const url = `${base}/onboarding?from=shopify&shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
            topNavigate(url);
        };
    }
  }

  if (btnReload) btnReload.onclick = () => window.location.reload();

  boot().catch((e) => {
    setStatus('Error');
    showError(e?.stack || e?.message || String(e));
  });
})();



