// public/js/onboarding3.js
document.addEventListener("DOMContentLoaded", async () => {
  
  const btn = document.getElementById("continue-btn-3");
  const progressBar = document.querySelector(".progress-indicator");
  const progressText = document.querySelector(".progress-text");
  if (btn) btn.disabled = true;

  
  const stepEls = Array.from(document.querySelectorAll(".analysis-step")).map((el) => ({
    root: el,
    icon: el.querySelector(".analysis-step-icon"),
    text: el.querySelector(".analysis-step-text"),
  }));

  
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

  
  const TYPE_TO_INDEX = { google: 0, meta: 1, shopify: 2 };
  const INDEX_TO_LABEL = {
    0: "Analizando Google Ads",
    1: "Analizando Meta Ads",
    2: "Analizando Shopify",
    3: "Generando recomendaciones",
  };

  
  for (let i = 0; i < stepEls.length; i++) {
    setStepLabel(i, INDEX_TO_LABEL[i] || "Procesando…");
  }

  let resultsPayload = null;

  try {
   
    const sess = await getJSON("/api/session");
    if (!sess?.authenticated) throw new Error("Sesión no encontrada. Inicia sesión nuevamente.");

    const googleConnected = !!sess.user?.googleConnected;
    const metaConnected   = !!sess.user?.metaConnected;
    const shopConnected   = !!sess.user?.shopifyConnected;

    
    for (const t of ["google", "meta", "shopify"]) {
      const idx = TYPE_TO_INDEX[t];
      if (idx !== undefined) markRunning(idx);
    }

    
    if (!googleConnected) markOmit(TYPE_TO_INDEX.google, "no conectado");
    if (!metaConnected)   markOmit(TYPE_TO_INDEX.meta, "no conectado");
    if (!shopConnected)   markOmit(TYPE_TO_INDEX.shopify, "no conectado");

    setText("Recopilando datos…");

    
    const json = await postJSON("/api/audits/run", {
      googleConnected,
      metaConnected,
      shopifyConnected: shopConnected,
    });

    
    progress = Math.max(progress, 45);
    setBar(progress);

    const results = Array.isArray(json.results) ? json.results : [];
    resultsPayload = json;

   
    const seen = new Set();
    for (const r of results) {
      if (!r?.type) continue;
      seen.add(r.type);
      const idx = TYPE_TO_INDEX[r.type];
      if (idx === undefined) continue;
      if (r.ok) markDone(idx);
      else markOmit(idx, r.error || "error");
      progress = Math.min(95, progress + 15);
      setBar(progress);
    }

    
    for (const t of ["google", "meta", "shopify"]) {
      if (!seen.has(t)) {
        const idx = TYPE_TO_INDEX[t];
        if (idx !== undefined) markOmit(idx, "no conectado");
      }
    }

    
    const finalIdx = Math.min(3, stepEls.length - 1);
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


document.getElementById("continue-btn-3")?.addEventListener("click", () => {
  window.location.href = "/onboarding4.html";
});
