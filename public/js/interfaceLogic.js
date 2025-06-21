// public/js/interfaceLogic.js

import { initAppBridge } from './appBridgeInit.js';

document.addEventListener('DOMContentLoaded', async () => {
  const qs = new URLSearchParams(location.search);
  const shop = qs.get("shop") || "";
  const host = qs.get("host") || "";

  document.getElementById("shopDom").textContent = shop;

  const back = new URL("https://adnova-app.onrender.com/onboarding");
  back.searchParams.set("shop", shop);
  if (host) back.searchParams.set("host", host);

  const goBtn = document.getElementById("backToAdnova");
  goBtn.href = back.toString();

  goBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    sessionStorage.setItem("shopDomain", shop);

    try {
      const { app, getSessionToken } = await window.initAppBridge();
      const token = await getSessionToken(app);

      sessionStorage.setItem("sessionToken", token);
      sessionStorage.setItem("shopifyConnected", "true");
      back.searchParams.set("sessionToken", token);

      window.top.location.href = back.toString();
    } catch (err) {
      console.error("❌ Error obteniendo sessionToken:", err);
      alert("No se pudo obtener el token de sesión");
    }
  });
});
