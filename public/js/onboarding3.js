// public/js/onboarding3.js
document.addEventListener("DOMContentLoaded", async () => {
  // ----- UI refs -----
  const btn = document.getElementById("continue-btn-3");
  const progressBar = document.querySelector(".progress-indicator");
  const progressText = document.querySelector(".progress-text");
  if (btn) btn.disabled = true;

  // 4 slots ya presentes en tu HTML
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
    const s = stepEls[idx]; if (!s) return;
    s.root.classList.add("active");
    s.root.classList.remove("completed", "opacity-50");
    if (s.icon) s.icon.textContent = "⟳";
  };
  const markDone = (idx) => {
    const s = stepEls[idx]; if (!s) return;
    s.root.classList.add("completed");
    s.root.classList.remove("active", "opacity-50");
    if (s.icon) s.icon.textContent = "✓";
  };
  const markOmit = (idx, reason = "") => {
    const s = stepEls[idx]; if (!s) return;
    s.root.classList.remove("active", "completed");
    s.root.classList.add("opacity-50");
    if (s.icon) s.icon.textContent = "○";
    if (s.text && !s.text.textContent.includes("(omitido)")) {
      s.text.textContent = (s.text.textContent || "") + " (omitido" + (reason ? `: ${reason}` : "") + ")";
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

  // HTTP helpers
  const getJSON = (url) =>
    fetch(url, { credentials: "include" }).then((r) => r.json()).catch(() => ({}));

  const postJSON = (url, body) =>
    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(async (r) => {
      let json = null;
      try { json = await r.json(); } catch {}
      if (!r.ok || json?.ok === false) {
        const msg = json?.detail || json?.error || `${url} failed`;
        throw new Error(msg);
      }
      return json || {};
    });

  // Mapeo de tipos → índice visual (usa los 3 primeros slots)
  // Orden fijo para consistencia con tu UI: Google, Meta, Shopify
  const TYPE_TO_INDEX = { google: 0, meta: 1, shopify: 2 };
  const INDEX_TO_LABEL = {
    0: "Analizando Google Ads",
    1: "Analizando Meta Ads",
    2: "Analizando Shopify",
    3: "Generando recomendaciones",
  };

  // Pre-pinta labels (si faltan pasos, el 3er/4to slot sigue sirviendo para el texto final)
  for (let i = 0; i < stepEls.length; i++) {
    setStepLabel(i, INDEX_TO_LABEL[i] || "Procesando…");
  }

  // Resultados que podrías querer reusar más adelante
  let resultsPayload = null;

  try {
    // Verifica sesión para UX (opcional)
    const sess = await getJSON("/api/session");
    if (!sess?.authenticated) throw new Error("Sesión no encontrada. Inicia sesión nuevamente.");

    // Marca “running” los 3 primeros pasos (si alguno no está conectado, lo omitimos luego)
    for (const t of ["google", "meta", "shopify"]) {
      const idx = TYPE_TO_INDEX[t];
      if (idx !== undefined) markRunning(idx);
    }

    setText("Recopilando datos…");

    // 🔥 ÚNICA llamada: lanza todas las auditorías disponibles
    const json = await postJSON("/api/audits/run", {});

    // Avanza progreso intermedio
    progress = Math.max(progress, 45);
    setBar(progress);

    const results = Array.isArray(json.results) ? json.results : [];
    resultsPayload = json;

    // Marca estado por tipo en UI
    const seen = new Set();
    for (const r of results) {
      if (!r?.type) continue;
      seen.add(r.type);
      const idx = TYPE_TO_INDEX[r.type];
      if (idx === undefined) continue;
      if (r.ok) markDone(idx);
      else markOmit(idx, r.error || "error");
      // Sube progresivamente
      progress = Math.min(95, progress + 15);
      setBar(progress);
    }

    // Cualquier tipo no ejecutado = no conectado → omitir
    for (const t of ["google", "meta", "shopify"]) {
      if (!seen.has(t)) {
        const idx = TYPE_TO_INDEX[t];
        if (idx !== undefined) markOmit(idx, "no conectado");
      }
    }

    // Paso final (slot 4) visual
    const finalIdx = Math.min(3, stepEls.length - 1);
    markDone(finalIdx);

    running = false;
    setBar(100);
    setText("¡Análisis completado!");
    if (btn) btn.disabled = false;

    // Guarda resumen para posible uso en el siguiente paso o dashboard
    try {
      sessionStorage.setItem("auditResult", JSON.stringify(resultsPayload));
    } catch {}
  } catch (err) {
    console.error(err);
    running = false;
    setBar(100);
    if (progressBar) progressBar.style.background = "#f55";
    setText(err?.message || "Ocurrió un error. Puedes continuar.");
    alert(err?.message || "Ocurrió un problema. Puedes continuar y revisar luego en el dashboard.");

    // Marca omitidos todos los pasos visibles y permite continuar
    stepEls.forEach((_, i) => markOmit(i));
    if (btn) btn.disabled = false;
  }
});

// Botón continuar
document.getElementById("continue-btn-3")?.addEventListener("click", () => {
  // Mantengo tu navegación existente
  window.location.href = "/onboarding4.html";
});
