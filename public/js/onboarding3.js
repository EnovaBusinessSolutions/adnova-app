document.addEventListener("DOMContentLoaded", async () => {
  // ----- UI refs -----
  const btn = document.getElementById("continue-btn-3");
  const progressBar = document.querySelector(".progress-indicator");
  const progressText = document.querySelector(".progress-text");
  if (btn) btn.disabled = true;

  // Slots de pasos existentes en tu HTML
  const stepEls = Array.from(document.querySelectorAll(".analysis-step")).map((el) => ({
    root: el,
    icon: el.querySelector(".analysis-step-icon"),
    text: el.querySelector(".analysis-step-text"),
  }));

  // Helpers UI
  const setText = (t) => { if (progressText) progressText.textContent = t; };
  const setBar  = (pct) => { if (progressBar) progressBar.style.width = `${pct}%`; };

  const setStepLabel = (idx, label) => {
    const s = stepEls[idx];
    if (s?.text) s.text.textContent = label;
  };
  const markRunning = (idx) => {
    const s = stepEls[idx];
    if (!s) return;
    s.root.classList.add("active");
    s.root.classList.remove("completed");
    if (s.icon) s.icon.textContent = "⟳";
  };
  const markDone = (idx) => {
    const s = stepEls[idx];
    if (!s) return;
    s.root.classList.add("completed");
    s.root.classList.remove("active");
    if (s.icon) s.icon.textContent = "✓";
  };
  const markOmit = (idx) => {
    const s = stepEls[idx];
    if (!s) return;
    s.root.classList.remove("active");
    s.root.classList.remove("completed");
    s.root.classList.add("opacity-50");
    if (s.icon) s.icon.textContent = "○";
    if (s.text && !s.text.textContent.includes("(omitido)")) {
      s.text.textContent = (s.text.textContent || "") + " (omitido)";
    }
  };

  // Animación base
  let progress = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    if (progress < 90) {
      progress += Math.random() * 2 + 1; // 1–3%
      if (progress > 90) progress = 90;
      setBar(progress);
      setTimeout(tick, 250);
    }
  };
  setBar(0);
  setText("Preparando análisis…");
  tick();

  // HTTP helper
  const postJSON = (url, body) =>
    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(async (r) => {
      if (!r.ok) {
        let msg = "";
        try {
          const j = await r.json();
          msg = j?.error || "";
        } catch {}
        throw new Error(msg || `${url} failed`);
      }
      return r.json();
    });

  // Resultados por si quieres usarlos en la siguiente pantalla
  let resShopify = null, resMeta = null, resGoogle = null;

  try {
    // 1) Lee sesión real
    const sess = await fetch("/api/session", { credentials: "include" }).then((r) => r.json());
    if (!sess?.authenticated) throw new Error("Sesión no encontrada. Inicia sesión nuevamente.");

    const user = sess.user || {};
    const hasShopify = !!user.shopifyConnected && !!user.shop;
    const hasMeta    = !!user.metaConnected;
    const hasGoogle  = !!user.googleConnected;

    // Por compatibilidad con otras pantallas:
    try {
      sessionStorage.setItem("userId", user._id || "");
      sessionStorage.setItem("shop", user.shop || "");
    } catch {}

    // 2) Construye tareas según conexiones
    const tasks = [];
    if (hasShopify) tasks.push({ id: "shopify", label: "Analizando Shopify", run: async () => {
      // En modo sesión no necesitas enviar shop/accessToken
      resShopify = await postJSON("/api/audit/start", {});
    }});
    if (hasMeta) tasks.push({ id: "meta", label: "Analizando Meta Ads", run: async () => {
      resMeta = await postJSON("/api/audit/meta/start", { datePreset: "last_30d" });
    }});
    if (hasGoogle) tasks.push({ id: "google", label: "Analizando Google Ads", run: async () => {
      // Puedes pasar client_customer_id (sin guiones) si ya lo tienes
      resGoogle = await postJSON("/api/audit/google/start", { date_range: "LAST_30_DAYS" });
    }});

    // 3) Mapea labels a tus 4 slots
    // Si hay menos de 4 tareas, completamos con "Generando recomendaciones"
    const labels = tasks.map(t => t.label);
    while (labels.length < stepEls.length) labels.push("Generando recomendaciones");
    stepEls.forEach((_, i) => setStepLabel(i, labels[i]));

    // 4) Si no hay conexiones, permite continuar
    if (!tasks.length) {
      running = false;
      setBar(100);
      setText("No hay conexiones activas. Puedes continuar.");
      if (btn) btn.disabled = false;
      // Marca como omitidos los 4 pasos
      stepEls.forEach((_, i) => markOmit(i));
      return;
    }

    // 5) Ejecuta tareas en serie actualizando tus 4 pasos
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      markRunning(i);
      setText(`${t.label}…`);
      try {
        await t.run();
      } catch (e) {
        console.error(`[${t.id}]`, e);
        // No detenemos el flujo: marcamos omitido este paso y continuamos
        markOmit(i);
      }
      // Progreso intermedio manual
      progress = Math.min(95, progress + Math.ceil(70 / tasks.length));
      setBar(progress);
      markDone(i);
    }

    // 6) Pasos restantes (si quedaron) → márquelos como completados rápidamente
    for (let j = tasks.length; j < stepEls.length - 1; j++) {
      markDone(j);
    }

    // 7) Finaliza
    running = false;
    setBar(100);
    markDone(stepEls.length - 1);
    setText("¡Análisis completado!");
    if (btn) btn.disabled = false;

    // Guarda payload combinado (opcional)
    try {
      const payload = {
        shopify: resShopify?.resultado || resShopify || null,
        meta:    resMeta?.resultado    || resMeta    || null,
        google:  resGoogle?.resultado  || resGoogle  || null,
      };
      sessionStorage.setItem("auditResult", JSON.stringify(payload));
    } catch {}
  } catch (err) {
    // Error de sesión u otro fatal → permite continuar
    console.error(err);
    running = false;
    setBar(100);
    if (progressBar) progressBar.style.background = "#f55";
    setText(err?.message || "Ocurrió un error. Puedes continuar.");
    alert(err?.message || "Ocurrió un problema. Puedes continuar y revisar luego en el dashboard.");
    if (btn) btn.disabled = false;
    // Marca todos como omitidos para dejar claro que no se corrió
    stepEls.forEach((_, i) => markOmit(i));
  }
});

// Botón continuar
document.getElementById("continue-btn-3")?.addEventListener("click", () => {
  window.location.href = "/onboarding4.html";
});
