// public/js/onboarding3.js
document.addEventListener("DOMContentLoaded", async () => {
  const btn = document.getElementById("continue-btn-3");
  const progressBar = document.querySelector(".progress-indicator");
  const progressText = document.querySelector(".progress-text");
  if (btn) btn.disabled = true;

  // Pasos visuales existentes en el DOM (no tocamos Shopify)
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
    if (s?.text && label) s.text.textContent = label;
  };
  const markRunning = (idx) => {
    const s = stepEls[idx]; if (!s) return;
    s.root.classList.add("active");
    s.root.classList.remove("completed", "opacity-50");
    if (s.icon) s.icon.textContent = "●";
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

  // Animación de progreso
  let progress = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    if (progress < 90) {
      progress += Math.random() * 2 + 1;
      if (progress > 90) progress = 90;
      setBar(progress);
      setTimeout(tick, 250);
    }
  };
  setBar(0);
  setText("Preparando análisis…");
  tick();

  // HTTP helpers
  const getJSON = async (url) => {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    try { return await r.json(); } catch { return {}; }
  };

  const postJSON = async (url, body) => {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    let json = null;
    try { json = await r.json(); } catch {}
    if (!r.ok || json?.ok === false) {
      const msg = (json?.error || `HTTP_${r.status}`) +
                  (json?.detail ? ` — ${json.detail}` : "") +
                  (json?.hint ? ` — ${json.hint}` : "");
      const err = new Error(msg);
      err._raw = { status: r.status, json };
      throw err;
    }
    return json || {};
  };

  // Índices de pasos en pantalla:
  // 0: Google Ads, 1: Meta Ads, 2: Shopify (se mantiene), 3: Google Analytics (nuevo), 4: Recomendaciones
  const TYPE_TO_INDEX = { google: 0, meta: 1, shopify: 2, ga4: 3 };
  const INDEX_TO_LABEL = {
    0: "Analizando Google Ads",
    1: "Analizando Meta Ads",
    2: "Analizando Shopify",
    3: "Analizando Google Analytics",
    4: "Generando recomendaciones",
  };

  // Etiquetas iniciales (si no existe el nodo, no pasa nada)
  for (let i = 0; i < stepEls.length; i++) {
    setStepLabel(i, INDEX_TO_LABEL[i] || "Procesando…");
  }

  let resultsPayload = { ok: false, results: [] };

  try {
    // 1) Sesión y estado de conexiones
    const sess = await getJSON("/api/session");
    if (!sess?.authenticated) throw new Error("Sesión no encontrada. Inicia sesión nuevamente.");

    const googleConnected = !!sess.user?.googleConnected;
    const metaConnected   = !!sess.user?.metaConnected;
    const shopConnected   = !!sess.user?.shopifyConnected;
    const ga4Connected    = googleConnected; // GA4 comparte OAuth con Google (propiedad por defecto se valida en backend)

    // Marca "corriendo" los pasos visibles
    for (const t of ["google", "meta", "shopify", "ga4"]) {
      const idx = TYPE_TO_INDEX[t];
      if (idx !== undefined) markRunning(idx);
    }

    // Omisiones por desconexión
    if (!googleConnected) markOmit(TYPE_TO_INDEX.google, "no conectado");
    if (!metaConnected)   markOmit(TYPE_TO_INDEX.meta, "no conectado");
    if (!shopConnected)   markOmit(TYPE_TO_INDEX.shopify, "no conectado");
    if (!ga4Connected)    markOmit(TYPE_TO_INDEX.ga4, "no conectado");

    setText("Recopilando datos…");

    // 2) Disparar auditorías REALES por fuente (individuales)
    const tasks = [];

    const runSource = async (source, connected) => {
      const idx = TYPE_TO_INDEX[source];
      if (!connected) {
        return { type: source, ok: false, error: "NOT_CONNECTED" };
      }
      try {
        const res = await postJSON(`/api/audits/${source}/run`, {});
        if (idx !== undefined) markDone(idx);
        progress = Math.min(95, progress + 12);
        setBar(progress);
        return { type: source, ok: true, ...res };
      } catch (e) {
        console.warn(`${source} audit failed`, e);
        if (idx !== undefined) markOmit(idx, "error");
        progress = Math.min(95, progress + 8);
        setBar(progress);
        return { type: source, ok: false, error: e?.message || "ERROR" };
      }
    };

    tasks.push(runSource("google",  googleConnected));
    tasks.push(runSource("meta",    metaConnected));
    tasks.push(runSource("shopify", shopConnected)); // no tocamos Shopify (si tu backend lo ignora, simplemente marcará omit/error)
    tasks.push(runSource("ga4",     ga4Connected));

    const results = await Promise.all(tasks);
    resultsPayload = { ok: true, results };

    // 3) Paso final (recomendaciones)
    const finalIdx = Math.min(4, stepEls.length - 1);
    markDone(finalIdx);

    running = false;
    setBar(100);
    setText("¡Análisis completado!");
    if (btn) btn.disabled = false;

    try { sessionStorage.setItem("auditResult", JSON.stringify(resultsPayload)); } catch {}
  } catch (err) {
    console.error("RUN_ERROR:", err?._raw || err);
    running = false;
    setBar(100);
    if (progressBar) progressBar.style.background = "#f55";
    setText("RUN_ERROR");
    alert("RUN_ERROR\n\n" + (err?.message || "Ocurrió un problema."));

    stepEls.forEach((_, i) => markOmit(i, "error"));
    if (btn) btn.disabled = false;
  }
});

// Continuar
document.getElementById("continue-btn-3")?.addEventListener("click", () => {
  window.location.href = "/onboarding4.html";
});
