document.addEventListener("DOMContentLoaded", async () => {
  const qs = new URLSearchParams(location.search);
  const shop = qs.get("shop") || "";
  const host = qs.get("host") || "";

  // Muestra el dominio en la interfaz
  document.getElementById("shopDom").textContent = shop;

  // Construimos la URL de retorno al SAAS
  const back = new URL("https://adnova-app.onrender.com/onboarding");
  back.searchParams.set("shop", shop);
  if (host) back.searchParams.set("host", host);

  const btn = document.getElementById("goToAdnova");
  btn.disabled = true;

  try {
    const { app, getSessionToken } = await window.initAppBridge();
    const token = await getSessionToken(app);

    if (!token) throw new Error("Token vacío");

    sessionStorage.setItem("sessionToken", token);
    sessionStorage.setItem("shopDomain", shop);
    sessionStorage.setItem("shopifyConnected", "true");

    back.searchParams.set("sessionToken", token);
    btn.disabled = false;

    btn.addEventListener("click", () => {
      window.top.location.href = back.toString();
    });

    console.log("✅ Token obtenido correctamente");
  } catch (err) {
    console.error("❌ Error obteniendo sessionToken:", err);
    alert("No se pudo obtener el token de sesión. Intenta refrescar.");
  }
});
