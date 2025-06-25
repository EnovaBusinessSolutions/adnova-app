// --- Parámetros de la URL ---
const apiKey = document.querySelector('meta[name="shopify-api-key"]').content;
const params = new URLSearchParams(window.location.search);
const host = params.get('host');
const shop = params.get('shop');

// Mostrar dominio en la UI
if (shop) document.getElementById("shopDom").textContent = shop;

// Verificación rápida
if (!apiKey || !host) {
  document.body.innerHTML = "<h2>Error: Falta apiKey o host en la URL.<br>Debes abrir esta app desde el panel de Shopify.</h2>";
  throw new Error("Falta apiKey o host en la URL");
}

// --- Inicializa App Bridge y obtiene session token ---
let sessionToken = null;
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const AppBridge = window['app-bridge'];
    if (!AppBridge) {
      throw new Error("App Bridge NO está disponible en window['app-bridge']");
    }
    const createApp = AppBridge.default;
    const app = createApp({ apiKey, host });
    sessionToken = await AppBridge.getSessionToken(app);
    if (!sessionToken) throw new Error("No se pudo obtener sessionToken");
    sessionStorage.setItem("sessionToken", sessionToken);
 
 await fetch('/api/ping', {
  headers: { Authorization: `Bearer ${sessionToken}` }
});

    // Puedes habilitar el botón cuando ya tienes el token
    document.getElementById("goToAdnova").disabled = false;
  } catch (err) {
    document.getElementById("goToAdnova").disabled = true;
    document.body.innerHTML += "<p style='color:#ff6666'><b>Error App Bridge:</b> " + err.message + "</p>";
  }
});

// --- Redirigir al SAAS con el token y dominio ---
document.getElementById("goToAdnova").addEventListener("click", function() {
  // Asegúrate de que el sessionToken fue obtenido
  if (!sessionToken) {
    alert("El token de sesión no está listo. Espera unos segundos e intenta de nuevo.");
    return;
  }
  // Cambia la URL a la de tu app SAAS, pasando shop y (si quieres) el token
  window.open(`https://adnova-app.onrender.com/onboarding?shop=${encodeURIComponent(shop)}`, "_blank");
});
