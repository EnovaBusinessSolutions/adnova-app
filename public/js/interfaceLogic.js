import { app, getSessionToken } from './appBridgeInit.js';

document.addEventListener('DOMContentLoaded', () => {
  const qs   = new URLSearchParams(location.search);
  const shop = qs.get('shop') || '';
  const host = qs.get('host') || '';

  // Mostrar dominio en pantalla
  document.getElementById('shopDom').textContent = shop;

  // Construir URL de retorno al onboarding
  const back = new URL('https://adnova-app.onrender.com/onboarding');
  back.searchParams.set('shop', shop);
  if (host) back.searchParams.set('host', host);

  const goBtn = document.getElementById('backToAdnova');
  goBtn.href = back.toString();

  goBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (shop) sessionStorage.setItem('shopDomain', shop);

    try {
      // Obtener sessionToken con App Bridge
      const token = await getSessionToken(app);
      sessionStorage.setItem('sessionToken', token);
      sessionStorage.setItem('shopifyConnected', 'true');

      // Añadirlo a la URL y redirigir fuera del iframe
      back.searchParams.set('sessionToken', token);
      window.top.location.href = back.toString();
    } catch (err) {
      console.error("❌ Error obteniendo sessionToken:", err);
      alert("No se pudo obtener el token de sesión");
    }
  });
});
