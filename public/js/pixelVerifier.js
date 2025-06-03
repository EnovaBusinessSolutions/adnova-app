// public/js/pixelVerifier.js

document.addEventListener('DOMContentLoaded', function () {
  // Guardar JWT de Shopify si viene en la URL (por si acceden directamente)
  const params = new URLSearchParams(window.location.search);
  const jwtShopify = params.get('shopifyToken');
  if (jwtShopify) {
    localStorage.setItem('shopifyToken', jwtShopify);
  }

  const checkPixelBtn = document.getElementById('checkPixelBtn');
  const pixelResult = document.getElementById('pixelResult');

  if (checkPixelBtn && pixelResult) {
    checkPixelBtn.addEventListener('click', async () => {
      try {
        const token = localStorage.getItem('shopifyToken');
        if (!token) throw new Error('No token');
        const res = await fetch('/api/test-shopify-token', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          pixelResult.innerText = '✅ Píxel activo para ' + data.shop;
        } else {
          throw new Error('No válido');
        }
      } catch (err) {
        pixelResult.innerText = '❌ No se pudo verificar. Conecta primero Shopify.';
      }
    });
  }
});
