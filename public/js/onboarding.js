// public/js/onboarding.js

document.addEventListener('DOMContentLoaded', function () {
  // 1) Capturamos el JWT de Shopify si viene en la URL y lo guardamos en localStorage
  const params = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    localStorage.setItem('shopifyToken', jwtShopify);
  }

  const steps = document.querySelectorAll('.step');
  const contents = document.querySelectorAll('.step-content');
  let currentStep = 1;

  // 2) Paso 1: Conectar Shopify
  //    Ahora usamos el ID real: "connect-shopify" (coincide con onboarding.html)
  const connectShopifyBtn = document.getElementById('connect-shopify');
  if (connectShopifyBtn) {
    connectShopifyBtn.addEventListener('click', () => {
      // USER_ID_REAL ya fue reemplazado al renderizar index.js
      const userId = document.body.dataset.userId; // alternativo a "USER_ID_REAL"
      const shop = prompt('Ingresa tu dominio (ejemplo.myshopify.com):');
      if (!shop || !shop.endsWith('.myshopify.com')) {
        alert('Dominio inválido. Debe terminar en ".myshopify.com".');
        return;
      }
      window.location.href = `/api/shopify/connect?userId=${userId}&shop=${shop}`;
    });
  }

  // 3) Paso 2: Conectar Google
  //    En onboarding.html el enlace es <a href="/auth/google" id="connect-google-btn">
  const connectGoogleBtn = document.getElementById('connect-google-btn');
  if (connectGoogleBtn) {
    connectGoogleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/auth/google';
    });
  }

  // 4) Paso 3: Conectar Meta
  //    En onboarding.html el enlace es <a href="/auth/meta/login" id="connect-meta-btn">
  const connectMetaBtn = document.getElementById('connect-meta-btn');
  if (connectMetaBtn) {
    connectMetaBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/auth/meta/login';
    });
  }

  // 5) Paso 4: Verificar Píxel
  //    En tu HTML no hay un botón con ID "verifyPixelBtn", así que lo removemos
  //    Si quieres reactivar esa funcionalidad, añade en onboarding.html:
  //    <button id="verifyPixelBtn" class="btn">Verificar Pixel</button>
  const verifyPixelBtn = document.getElementById('verifyPixelBtn');
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

  // 6) Paso 5: Finalizar Onboarding
  //    El botón en onboarding.html se llama "go-to-dashboard", así que lo ajustamos
  const finishOnboardingBtn = document.getElementById('go-to-dashboard');
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

  // 7) Navegación entre pasos si el usuario hace clic en el sidebar
  steps.forEach(step => {
    step.addEventListener('click', () => {
      const target = parseInt(step.dataset.step);
      if (target <= currentStep) {
        contents.forEach(c => c.classList.remove('active'));
        document.querySelector(`.step-content[data-step="${target}"]`).classList.add('active');
        currentStep = target;
      }
    });
  });
});
