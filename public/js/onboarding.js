// public/js/onboarding.js

document.addEventListener('DOMContentLoaded', function () {
  // Capturamos el JWT de Shopify si viene en la URL y lo guardamos en localStorage
  const params = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    localStorage.setItem('shopifyToken', jwtShopify);
  }

  const steps = document.querySelectorAll('.step');
  const contents = document.querySelectorAll('.step-content');
  let currentStep = 1;

  // Paso 1: Conectar Shopify
  const connectShopifyBtn = document.getElementById('connectShopifyBtn');
  if (connectShopifyBtn) {
    connectShopifyBtn.addEventListener('click', () => {
      const userId = "USER_ID_REAL";
      const shop = prompt('Ingresa tu dominio (ejemplo.myshopify.com):');
      if (!shop) return;
      window.location.href = `/api/shopify/connect?userId=${userId}&shop=${shop}`;
    });
  }

  // Paso 2: Conectar Google
  const connectGoogleBtn = document.getElementById('connectGoogleBtn');
  if (connectGoogleBtn) {
    connectGoogleBtn.addEventListener('click', () => {
      window.location.href = '/google';
    });
  }

  // Paso 3: Conectar Meta
  const connectMetaBtn = document.getElementById('connectMetaBtn');
  if (connectMetaBtn) {
    connectMetaBtn.addEventListener('click', () => {
      window.location.href = '/auth/meta/login';
    });
  }

  // Paso 4: Verificar Píxel
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

  // Paso 5: Finalizar Onboarding
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

  // Navegación entre pasos si el usuario hace clic en el sidebar
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
