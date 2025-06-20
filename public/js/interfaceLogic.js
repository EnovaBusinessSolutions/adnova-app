if (window.top === window) {
  alert("⚠️ No estás dentro de un iframe de Shopify. Abre esta app desde el Admin.");
}

const qs = new URLSearchParams(location.search);
const sessionToken = qs.get('sessionToken');
if (sessionToken) {
  sessionStorage.setItem('sessionToken', sessionToken);
}

const shop = qs.get('shop') || '';
const host = qs.get('host') || '';
document.getElementById('shopDom').textContent = shop;

// URL de regreso al SAAS
const back = new URL('https://adnova-app.onrender.com/onboarding');
back.searchParams.set('shop', shop);
if (host) back.searchParams.set('host', host);
document.getElementById('backToAdnova').href = back.toString();

document.getElementById('backToAdnova').addEventListener('click', async (e) => {
  e.preventDefault();
  if (shop) sessionStorage.setItem('shopDomain', shop);

  try {
    const token = await window.getSessionToken(window.app);
    sessionStorage.setItem('sessionToken', token);
    sessionStorage.setItem('shopifyConnected', 'true');
    back.searchParams.set('sessionToken', token);
    window.top.location.href = back.toString();
  } catch (err) {
    console.error("❌ Error obteniendo sessionToken:", err);
    alert("No se pudo obtener el token de sesión");
  }
});
