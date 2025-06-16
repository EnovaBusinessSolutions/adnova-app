// public/js/onboarding.js  (versión completa)
document.addEventListener('DOMContentLoaded', async () => {

  /* =================  Referencias  ================= */
  const connectShopifyBtn = document.getElementById('connect-shopify-btn');
  const connectGoogleBtn  = document.getElementById('connect-google-btn');
  const continueBtn       = document.getElementById('continue-btn');

  const flagShopify = document.getElementById('shopifyConnectedFlag');
  const flagGoogle  = document.getElementById('googleConnectedFlag');

  /* Paso extra del dominio */
  const domainStep  = document.getElementById('shopify-domain-step');
  const domainInput = document.getElementById('shop-domain-input');
  const domainSend  = document.getElementById('shop-domain-send');

  /* Helper */
  function habilitarContinue() {
    if (flagShopify?.textContent.trim() === 'true') {
      continueBtn.disabled = false;
      continueBtn.classList.replace('btn-continue--disabled','btn-continue--enabled');
    }
  }

  /* ======  Funciones de UI  ====== */
  function pintarShopifyConectado() {
    connectShopifyBtn.textContent = 'Connected';
    connectShopifyBtn.classList.add('connected');
    connectShopifyBtn.disabled = true;

    /* bloquea input/botón para que no vuelva a abrirse */
    domainInput.disabled = true;
    domainSend.disabled  = true;
    domainStep?.classList.add('hidden');

    flagShopify.textContent = 'true';
    habilitarContinue();
  }
  function pintarGoogleConectado() {
    connectGoogleBtn.textContent = 'Connected';
    connectGoogleBtn.classList.add('connected');
    connectGoogleBtn.disabled = true;
  }

  /* Si ya venían flags pintamos al cargar */
  if (flagShopify?.textContent.trim()==='true') pintarShopifyConectado();
  if (flagGoogle ?.textContent.trim()==='true') pintarGoogleConectado();
  habilitarContinue();

  /* ====== 1 · Mostrar paso dominio si ?shop=…  ====== */
  const urlShop = new URLSearchParams(location.search).get('shop');
  if (urlShop && flagShopify.textContent.trim()!=='true') {
    domainStep.classList.remove('hidden');
    domainInput.value = urlShop;
  }

  /* ====== 2 · Listener “Connect Shopify” ====== */
  connectShopifyBtn?.addEventListener('click', (e)=>{
    e.preventDefault();
    if (flagShopify.textContent.trim()==='true') return;   // ya conectado

    const qs = new URLSearchParams(location.search);
    let shop = qs.get('shop');
    let host = qs.get('host');

    if (!shop || !host) {
      shop = prompt('Ingresa el dominio (ej: mitienda.myshopify.com):');
      if (!shop || !shop.endsWith('.myshopify.com')) return alert('Dominio inválido');
      host = btoa(`${shop}/admin`);
    }

    /* mostramos input mientras vuelve */
    domainStep.classList.remove('hidden');
    domainInput.value = shop;

    window.location.href =
      `/connector?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  });

  /* ====== 3 · Enviar dominio ====== */
  domainSend?.addEventListener('click', async ()=>{
    const shop = domainInput.value.trim().toLowerCase();
    if (!shop.endsWith('.myshopify.com')) return alert('Dominio inválido');

    const res  = await fetch('/api/shopify/match',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({shop})
    });
    const data = await res.json();
    if (data.ok) pintarShopifyConectado();
    else alert(data.error || 'No se pudo vincular la tienda');
  });

  /* ====== 4 · Google & Continue ====== */
  connectGoogleBtn?.addEventListener('click', ()=>window.location.href='/auth/google/connect');
  continueBtn     ?.addEventListener('click', ()=>window.location.href='/');

});
