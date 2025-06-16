/* public/js/onboarding.js */
document.addEventListener('DOMContentLoaded', async () => {

  /* -------------------------------- DOM -------------------------------- */
  const qs                = new URLSearchParams(location.search);
  const shopFromQuery     = qs.get('shop');                 // «shop» si viene de Shopify
  const hostFromQuery     = qs.get('host');                 // «host» en base-64

  const connectBtn        = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify       = document.getElementById('shopifyConnectedFlag');
  const flagGoogle        = document.getElementById('googleConnectedFlag');

  const domainStep        = document.getElementById('shopify-domain-step');
  const domainInput       = document.getElementById('shop-domain-input');
  const domainSend        = document.getElementById('shop-domain-send');

  /* --------  Si venimos de /connector/interface?shop=... activamos el step  -------- */
  if (shopFromQuery) {
    domainStep.classList.remove('step--hidden');      // muestra el bloque
    domainInput.value = shopFromQuery;                // auto-rellena
    domainInput.focus();
  }

  /* -------------------------------- Helpers -------------------------------- */
  function habilitarContinue() {
    if (!continueBtn) return;
    const done = flagShopify.textContent.trim() === 'true' ||
                 sessionStorage.getItem('shopifyConnected') === 'true';
    if (done) {
      continueBtn.disabled = false;
      continueBtn.classList.remove('btn-continue--disabled');
      continueBtn.classList.add('btn-continue--enabled');
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

  /* banderas pre-render */
  if (flagShopify.textContent.trim() === 'true') pintarShopifyConectado();
  if (flagGoogle .textContent.trim() === 'true') pintarGoogleConectado();
  habilitarContinue();

  /* ---------------------------  /api/session sync --------------------------- */
  try {
    const r = await fetch('/api/session', {credentials:'include'});
    if (r.ok) {
      const s = await r.json();
      if (s.user.shopifyConnected) pintarShopifyConectado();
      if (s.user.googleConnected ) pintarGoogleConectado();
    } else location.href = '/';
  } catch { location.href = '/'; }

  /* ---------------- “Connect Shopify” manual (sólo si no vino de Shopify) -- */
  connectBtn?.addEventListener('click', () => {
    const params = new URLSearchParams(location.search);
    let shop = params.get('shop');
    let host = params.get('host');

    /* prompt si no venimos de Shopify */
    if (!shop || !host){
      shop = prompt('Ingresa tu dominio (ej: mitienda.myshopify.com):');
      if (!shop?.endsWith('.myshopify.com')) return alert('Dominio inválido');
      host = btoa(`${shop}/admin`);
    }
    location.href = `/connector?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  });

  /* -------------- “Enviar dominio” para vincular shop con el usuario ---------- */
  domainSend?.addEventListener('click', async () => {
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    const res  = await fetch('/api/shopify/match', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({shop})
    });
    const data = await res.json();
    if (data.ok) {
      pintarShopifyConectado();
      domainStep.classList.add('step--hidden');   // lo ocultamos
    } else alert(data.error || 'No se pudo vincular la tienda.');
  });

  /* -----------------------  Google / Continue  ------------------------- */
  connectGoogleBtn?.addEventListener('click', () => location.href='/auth/google/connect');
  continueBtn      ?.addEventListener('click', () => location.href='/');
});
