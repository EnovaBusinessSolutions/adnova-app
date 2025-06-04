// public/js/onboarding.js

document.addEventListener('DOMContentLoaded', function () {
  // ---------------------------------------------------
  // 0) Revisar la bandera inyectada por el backend:
  //    Si ya estaba conectado en una sesión anterior,
  //    pintamos de verde el botón y habilitamos “Continue”.
  // ---------------------------------------------------
  const flagEl = document.getElementById('shopifyConnectedFlag');
  const alreadyConnectedShopify = flagEl && flagEl.textContent.trim() === 'true';

  if (alreadyConnectedShopify) {
    // Mostrar botón Shopify como “Connected” (verde)
    const connectBtn = document.getElementById('connect-shopify');
    if (connectBtn) {
      connectBtn.classList.add('connected');   // tu CSS .connected define fondo verde
      connectBtn.textContent = 'Connected';     // cambiamos texto
      connectBtn.disabled = true;               // opcional: evitar reclick
    }
    // Habilitar el botón “Continue”
    const continueBtn = document.getElementById('continue-btn');
    if (continueBtn) continueBtn.disabled = false;
  }

  // ---------------------------------------------------
  // 1) Capturamos el JWT que venga en la URL (shopifyToken)
  //    cuando Shopify redirige después de la autorización.
  // ---------------------------------------------------
  const params = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    // Guardamos el JWT en localStorage
    localStorage.setItem('shopifyToken', jwtShopify);

    // Pintar el botón Shopify como "Connected" (verde) y habilitar "Continue"
    const connectBtn = document.getElementById('connect-shopify');
    if (connectBtn) {
      connectBtn.classList.add('connected');
      connectBtn.textContent = 'Connected';
      connectBtn.disabled = true;
    }
    const continueBtn = document.getElementById('continue-btn');
    if (continueBtn) continueBtn.disabled = false;
  }

  // ---------------------------------------------------
  // 2) Event Listener: Click en “Connect Shopify”
  //    pedirá al usuario que ingrese su dominio y
  //    redirige a /api/shopify/connect?userId=xxx&shop=xxx
  // ---------------------------------------------------
  const connectShopifyBtn = document.getElementById('connect-shopify');
  if (connectShopifyBtn) {
    connectShopifyBtn.addEventListener('click', () => {
      const userId = "USER_ID_REAL"; // backend reemplaza "USER_ID_REAL" con el ID real
      const shop = prompt('Ingresa tu dominio (ejemplo.mytienda.myshopify.com):');
      if (!shop || !shop.endsWith('.myshopify.com')) {
        alert('Dominio inválido. Debe terminar en ".myshopify.com"');
        return;
      }
      // Redirigimos al servidor para iniciar OAuth con Shopify
      window.location.href = `/api/shopify/connect?userId=${userId}&shop=${encodeURIComponent(shop)}`;
    });
  }

  // ---------------------------------------------------
  // 3) Event Listener: Click en “Connect Google” (paso opcional)
  // ---------------------------------------------------
  const connectGoogleBtn = document.getElementById('connect-google');
  if (connectGoogleBtn) {
    connectGoogleBtn.addEventListener('click', () => {
      window.location.href = '/auth/google';
    });
  }

  // ---------------------------------------------------
  // 4) Event Listener: Click en “Connect Meta” (paso opcional)
  // ---------------------------------------------------
  const connectMetaBtn = document.getElementById('connect-meta');
  if (connectMetaBtn) {
    connectMetaBtn.addEventListener('click', () => {
      window.location.href = '/auth/meta/login';
    });
  }

  // ---------------------------------------------------
  // 5) Event Listener: Click en “Verify Pixel” (paso opcional)
  // ---------------------------------------------------
  const verifyPixelBtn = document.getElementById('verify-pixel-btn');
  if (verifyPixelBtn) {
    verifyPixelBtn.addEventListener('click', async () => {
      try {
        const token = localStorage.getItem('shopifyToken');
        if (!token) throw new Error('No token');
        const res = await fetch('/api/test-shopify-token', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          alert('✅ Token de Shopify válido para ' + data.shop);
        } else {
          throw new Error('Token inválido');
        }
      } catch (err) {
        alert('❌ Debes conectar e instalar la App en Shopify primero.');
      }
    });
  }

  // ---------------------------------------------------
  // 6) Event Listener: Click en “Finish Onboarding” (último paso)
  //    cuando el usuario apriete ese botón,
  //    llamamos a /api/complete-onboarding y luego a /dashboard.
  // ---------------------------------------------------
  const finishOnboardingBtn = document.getElementById('finishOnboardingBtn');
  if (finishOnboardingBtn) {
    finishOnboardingBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/complete-onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = '/dashboard';
        } else {
          alert(data.message || 'Error al finalizar onboard.');
        }
      } catch (err) {
        console.error(err);
        alert('❌ Error en el servidor');
      }
    });
  }

  // ---------------------------------------------------
  // 7) Navegación manual entre pasos haciendo click en el sidebar
  // ---------------------------------------------------
  const steps = document.querySelectorAll('.step');
  const contents = document.querySelectorAll('.content-panel');
  let currentStep = 1;
  steps.forEach(step => {
    step.addEventListener('click', () => {
      const target = parseInt(step.dataset.step);
      if (target <= currentStep) {
        contents.forEach(c => c.classList.add('hidden'));
        document.getElementById(`step${target}-content`).classList.remove('hidden');
        currentStep = target;
      }
    });
  });
});
