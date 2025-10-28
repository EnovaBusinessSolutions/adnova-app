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
    s.root.classList.remove("completed", "opacity-50", "is-current");
    if (s.icon) s.icon.textContent = "●";
  };
  const markDone = (idx) => {
    const s = stepEls[idx]; if (!s) return;
    s.root.classList.add("completed");
    s.root.classList.remove("active", "opacity-50", "is-current");
    if (s.icon) s.icon.textContent = "✓";
  };
  const markOmit = (idx, reason = "") => {
    const s = stepEls[idx]; if (!s) return;
    s.root.classList.remove("active", "completed", "is-current");
    s.root.classList.add("opacity-50");
    if (s.icon) s.icon.textContent = "○";
    if (s.text && !s.text.textContent.includes("(omitido)")) {
      s.text.textContent = (s.text.textContent || "") + " (omitido" + (reason ? `: ${reason}` : "") + ")";
    }
  };

  // === NUEVO: resaltar el paso activo ======================================
  const TYPE_TO_INDEX = { google: 0, meta: 1, shopify: 2, ga4: 3 };
  const INDEX_TO_LABEL = {
    0: "Analizando Google Ads",
    1: "Analizando Meta Ads",
    2: "Analizando Shopify",
    3: "Analizando Google Analytics",
    4: "Generando recomendaciones",
  };

  function setActiveStep(type) {
    const idx = TYPE_TO_INDEX[type];
    if (idx === undefined) return;

    // limpia el "current" de todos los pasos que no estén completados/omitidos
    stepEls.forEach((s, i) => {
      if (!s) return;
      if (!s.root.classList.contains("completed") && !s.root.classList.contains("opacity-50")) {
        s.root.classList.toggle("is-current", i === idx);
      } else {
        s.root.classList.remove("is-current");
      }
    });
  }
  // ==========================================================================

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

  // === Mensajes dinámicos (para que no parezca congelado) ===================
  const STATUS_MESSAGES = [
    "Conectando fuentes de datos…",
    "Sincronizando cuentas y permisos…",
    "Recopilando métricas clave…",
    "Analizando rendimiento por campaña…",
    "Buscando fugas de presupuesto…",
    "Detectando oportunidades de ROAS…",
    "Evaluando tendencias y estacionalidad…",
    "Calculando impacto potencial…",
    "Generando recomendaciones…"
  ];
  if (progressText) progressText.style.transition = "opacity .25s ease";

  function startStatusCycler(el, messages, { intervalMs = 2200 } = {}) {
    if (!el) return () => {};
    let i = 0;
    let killed = false;

    const swap = () => {
      if (killed) return;
      el.style.opacity = "0";
      setTimeout(() => {
        el.textContent = messages[i % messages.length];
        el.style.opacity = "1";
        i++;
      }, 180);
    };

    swap();
    const t = setInterval(swap, intervalMs);
    return () => { killed = true; clearInterval(t); };
  }

  function observeProgressStopCycler(stopFn) {
    const bar = document.querySelector(".progress-indicator");
    if (!bar || !stopFn) return;
    const obs = new MutationObserver(() => {
      const w = (bar.style.width || "").trim();
      const pct = Number(w.replace("%", ""));
      if (pct >= 99) {
        stopFn();
        setText("Listo: generando recomendaciones…");
        obs.disconnect();
      }
    });
    obs.observe(bar, { attributes: true, attributeFilter: ["style"] });
  }

  const stopCycler = startStatusCycler(progressText, STATUS_MESSAGES, { intervalMs: 2200 });
  observeProgressStopCycler(stopCycler);
  // ==========================================================================

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

  // Detección real de conexión GA4 (no paloma si no hay Analytics)
  const detectGA4Connected = async () => {
    try {
      const r = await fetch("/api/google/analytics/ping", { credentials: "include" });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        return j?.ok !== false; // ok:true => conectado; ok:false => no conectado
      }
      const r2 = await fetch("/api/google/analytics?ping=1", { credentials: "include" });
      return r2.ok;
    } catch {
      return false;
    }
  };

  // Etiquetas iniciales
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

    // GA4: requiere OAuth Google + verificación de Analytics en backend
    let ga4Connected = false;
    if (googleConnected) {
      ga4Connected = await detectGA4Connected();
    }

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
        // Si no está conectado, no lo marcamos como "activo"
        return { type: source, ok: false, error: "NOT_CONNECTED" };
      }

      // Resalta paso activo
      if (idx !== undefined) setActiveStep(source);

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

    // Ejecutamos en paralelo, pero el "activo" será el del último que se dispare/cambie
    tasks.push(runSource("google",  googleConnected));
    tasks.push(runSource("meta",    metaConnected));
    tasks.push(runSource("shopify", shopConnected));
    tasks.push(runSource("ga4",     ga4Connected));

    const results = await Promise.all(tasks);
    resultsPayload = { ok: true, results };

    // Limpia resaltado actual
    stepEls.forEach((s) => s.root.classList.remove("is-current"));

    // 3) Paso final (recomendaciones)
    const finalIdx = Math.min(4, stepEls.length - 1);
    markDone(finalIdx);

    running = false;
    setBar(100);
    stopCycler();
    setText("¡Análisis completado!");
    if (btn) btn.disabled = false;

    try { sessionStorage.setItem("auditResult", JSON.stringify(resultsPayload)); } catch {}
  } catch (err) {
    console.error("RUN_ERROR:", err?._raw || err);
    running = false;
    setBar(100);
    stopCycler();
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
