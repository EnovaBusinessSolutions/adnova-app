// public/js/interfaceLogic.js
document.addEventListener('DOMContentLoaded', () => {
  const qs = new URLSearchParams(location.search);
  const shop = qs.get("shop") || "";
  const host = qs.get("host") || "";

  // Mostrar dominio en la UI
  document.getElementById("shopDom").textContent = shop;

  const goBtn = document.getElementById("backToAdnova");

  goBtn.addEventListener("click", async (e) => {
    e.preventDefault();

    try {
      const { app, getSessionToken } = await window.initAppBridge();
      const token = await getSessionToken(app);

      if (!token) throw new Error("Token vacío o no obtenido");

      // Guardar en sessionStorage
      sessionStorage.setItem("shopDomain", shop);
      sessionStorage.setItem("sessionToken", token);
      sessionStorage.setItem("shopifyConnected", "true");

      // Redirigir al SAAS con los datos
      const redirectURL = new URL("https://adnova-app.onrender.com/onboarding");
      redirectURL.searchParams.set("shop", shop);
      redirectURL.searchParams.set("host", host);
      redirectURL.searchParams.set("sessionToken", token);

      window.top.location.href = redirectURL.toString();
    } catch (err) {
      console.error("❌ Error obteniendo sessionToken:", err);
      alert("No se pudo obtener el token de sesión. Intenta refrescar.");
    }
  });
});
