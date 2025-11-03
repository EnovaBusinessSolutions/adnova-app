// public/js/onboarding3.js
(function () {
  // =======================
  // ENDPOINTS
  // =======================
  const ENDPOINTS = {
    status:   "/api/onboarding/status", // GET → { ok, status:{ meta:{connected,count}, google:{connected,count}, shopify:{connected} } }
    start:    "/api/audits/start",      // POST { types: ['meta','google','ga4'] } → { ok, jobId }
    progress: "/api/audits/progress"    // GET  ?jobId=... → { ok, items:{...}, percent|overallPct, finished }
  };

  // =======================
  // DOM refs
  // =======================
  const $ = (sel) => document.querySelector(sel);
  const progressBar  = $("#progress-bar");
  const progressText = $("#progress-text");
  const btnContinue  = $("#btn-continue");

  const rows = {
    google:  $("#step-googleads"),
    meta:    $("#step-meta"),
    shopify: $("#step-shopify"),
    ga4:     $("#step-ga4"),
  };

  const BADGE = (row) => row?.querySelector("[data-badge]");
  const ICON  = (row) => row?.querySelector(".analysis-step-icon");

  // =======================
  // Helpers UI
  // =======================
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const setBar = (pct) => { if (progressBar) progressBar.style.width = clamp(pct, 0, 100) + "%"; };
  const setText = (t) => { if (progressText) progressText.textContent = t; };

  const setRowState = (row, { state = "idle", msg = "" } = {}) => {
    if (!row) return;
    row.classList.remove("active", "completed", "opacity-50", "is-current", "error");
    if (state === "running") {
      row.classList.add("active", "is-current");
      if (ICON(row))  ICON(row).textContent = "●";
      if (BADGE(row)) BADGE(row).textContent = msg || "Analizando…";
    } else if (state === "done") {
      row.classList.add("completed");
      if (ICON(row))  ICON(row).textContent = "✓";
      if (BADGE(row)) BADGE(row).textContent = msg || "Listo";
    } else if (state === "skipped") {
      row.classList.add("opacity-50");
      if (ICON(row))  ICON(row).textContent = "○";
      if (BADGE(row)) BADGE(row).textContent = msg || "Omitido";
    } else if (state === "error") {
      row.classList.add("error", "opacity-50");
      if (ICON(row))  ICON(row).textContent = "!";
      if (BADGE(row)) BADGE(row).textContent = msg || "Error";
    } else {
      if (ICON(row))  ICON(row).textContent = "○";
      if (BADGE(row)) BADGE(row).textContent = msg || "";
    }
  };

  const STATUS_MESSAGES = [
    "Conectando fuentes…",
    "Sincronizando permisos…",
    "Recopilando métricas…",
    "Analizando campañas…",
    "Detectando oportunidades…",
    "Generando recomendaciones…",
  ];
  function startCycler() {
    if (!progressText) return () => {};
    let i = 0, stop = false;
    const tick = () => {
      if (stop) return;
      progressText.style.opacity = "0";
      setTimeout(() => {
        setText(STATUS_MESSAGES[i % STATUS_MESSAGES.length]);
        progressText.style.opacity = "1";
        i++;
      }, 160);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(id); };
  }
  let cyclerStop = null;

  // =======================
  // HTTP helpers
  // =======================
  async function getJSON(url) {
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    let j = {};
    try { j = await r.json(); } catch {}
    return j;
  }
  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    let j = {};
    try { j = await r.json(); } catch {}
    if (!r.ok || j?.ok === false) {
      const msg = j?.error || `HTTP_${r.status}`;
      const e = new Error(msg);
      e.detail = j;
      throw e;
    }
    return j;
  }

  // =======================
  // Refresco desde BD (clave para barra y pills)
  // =======================
  async function refreshAuditStatusFromDB() {
    try {
      const resp = await getJSON("/api/audits/latest?type=all");

      // Soportamos dos formatos:
      // 1) { ok:true, data:{google,meta,ga4} }
      // 2) { ok:true, data:[...docs] } o { ok:true, items:[...docs] }
      const dict = (resp?.data && !Array.isArray(resp.data)) ? resp.data : {};
      const list = Array.isArray(resp?.items)
        ? resp.items
        : (Array.isArray(resp?.data) ? resp.data : []);

      const pick = (t) =>
        dict[t] || list.find((x) => String(x?.type).toLowerCase() === t) || null;

      const g  = pick("google");
      const m  = pick("meta");
      const ga = pick("ga4");

      const setFromDoc = (row, doc, labelBase) => {
        if (!row) return;
        const notAuth = !!doc?.inputSnapshot?.notAuthorized;
        if (!doc || notAuth) {
          setRowState(row, { state: "skipped", msg: (labelBase || "Analizando") + " No conectado" });
        } else {
          setRowState(row, { state: "done", msg: (labelBase || "Analizando") + " Listo" });
        }
      };

      setFromDoc(rows.google,  g,  "Analizando Google Ads");
      setFromDoc(rows.meta,    m,  "Analizando Meta Ads");
      setFromDoc(rows.ga4,     ga, "Analizando Google Analytics");

      // Progreso fallback contando solo filas no omitidas (conectadas)
      const eligibleRows = ["google","meta","ga4"]
        .map((k) => rows[k])
        .filter((row) => row && !row.classList.contains("opacity-50"));

      const done = eligibleRows.filter((row) => row.classList.contains("completed")).length;
      const pct  = eligibleRows.length ? Math.round((done / eligibleRows.length) * 100) : 100;

      const current = (() => {
        const w = progressBar?.style?.width || "0%";
        const n = parseInt(String(w).replace("%",""), 10);
        return isNaN(n) ? 0 : n;
      })();
      setBar(Math.max(current, pct));

      if (pct >= 100) {
        if (cyclerStop) cyclerStop();
        setText("¡Análisis completado!");
        if (btnContinue) btnContinue.disabled = false;
      }
    } catch (e) {
      console.warn("refreshAuditStatusFromDB error", e);
    }
  }

  // =======================
  // Main
  // =======================
  async function run() {
    try {
      if (btnContinue) btnContinue.disabled = true;
      setBar(0);
      setText("Preparando análisis…");
      cyclerStop = startCycler();

      // 1) Estado real de conexiones
      const st = await getJSON(ENDPOINTS.status);
      const status = st?.status || {};
      const isConnected = {
        google:  !!status.google?.connected,
        meta:    !!status.meta?.connected,
        shopify: !!status.shopify?.connected,
        ga4:     !!status.google?.connected && Number(status.google?.count || 0) > 0, // GA4 usa login de Google
      };

      // Pinta estado inicial
      Object.entries(rows).forEach(([k, row]) => {
        if (!row) return;
        if (!isConnected[k]) {
          const msg = (k === "ga4")
            ? (!!status.google?.connected ? "Conecta GA4" : "No conectado")
            : "No conectado";
          setRowState(row, { state: "skipped", msg });
        } else {
          setRowState(row, { state: "running", msg: "Analizando…"});
        }
      });

      // Fuentes a procesar realmente
      const toRun = ["google","meta","ga4"].filter((k) => isConnected[k]);

      if (toRun.length === 0) {
        await refreshAuditStatusFromDB();
        setBar(100);
        if (cyclerStop) cyclerStop();
        setText("No hay fuentes conectadas.");
        if (btnContinue) btnContinue.disabled = false;
        return;
      }

      // 2) Disparar auditorías
      let jobId = null;
      try {
        const startResp = await postJSON(ENDPOINTS.start, { types: toRun });
        jobId = startResp?.jobId || null;
      } catch (e) {
        console.warn("No se pudo iniciar job de auditorías:", e?.message || e);
      }

      // Refresco por BD aunque no haya jobId
      const bdInterval = setInterval(refreshAuditStatusFromDB, 3000);
      setTimeout(() => refreshAuditStatusFromDB(), 7000);

      // 3) Polling de progreso (si tenemos job)
      let finished = false;
      let lastSnapshot = null;

      async function poll() {
        if (!jobId) return; // sin jobId dependemos del refresco por BD
        try {
          const q = `${ENDPOINTS.progress}?jobId=${encodeURIComponent(jobId)}`;
          const p = await getJSON(q);
          lastSnapshot = p;

          const overall = Number((p && (p.overallPct ?? p.percent)) ?? 0);
          if (!isNaN(overall)) setBar(overall);
          if (overall >= 100 || p?.finished === true) finished = true;

          const items = p?.items || {};
          for (const [key, row] of Object.entries(rows)) {
            if (!row || !isConnected[key]) continue;
            const it = items[key];

            if (!it) {
              setRowState(row, { state: "running", msg: "Analizando…" });
              continue;
            }

            const raw  = (it.state || it.status || "").toString().toLowerCase();
            const pct  = (typeof it.pct === "number")
              ? Math.round(it.pct)
              : (typeof it.percent === "number" ? Math.round(it.percent) : null);

            let state = "running";
            if (raw === "done") state = "done";
            else if (raw === "error") state = "error";

            const label =
              state === "running"
                ? (pct != null ? `Analizando… ${pct}%` : "Analizando…")
                : (it.msg || (state === "done" ? "Listo" : "Error"));
            setRowState(row, { state, msg: label });
          }

          if (!finished) {
            setTimeout(poll, 1200);
          } else {
            clearInterval(bdInterval);
            if (cyclerStop) cyclerStop();
            setBar(100);
            setText("¡Análisis completado!");
            if (btnContinue) btnContinue.disabled = false;
            try { sessionStorage.setItem("auditProgressSnapshot", JSON.stringify(lastSnapshot || {})); } catch {}
            refreshAuditStatusFromDB();
          }
        } catch (e) {
          console.warn("Polling error", e);
          clearInterval(bdInterval);
          await refreshAuditStatusFromDB();
          if (cyclerStop) cyclerStop();
          setText("Análisis finalizado (con advertencias). Puedes continuar.");
          setBar(100);
          if (btnContinue) btnContinue.disabled = false;
        }
      }

      poll();
    } catch (e) {
      console.error("ONBOARDING3_INIT_ERROR", e);
      if (cyclerStop) cyclerStop();
      setText("Error iniciando el análisis");
      setBar(100);
      Object.values(rows).forEach((row) => row && setRowState(row, { state: "error", msg: "Error" }));
      if (btnContinue) btnContinue.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", run);

  // Navegación
  btnContinue?.addEventListener("click", () => {
    window.location.href = "/onboarding4.html";
  });
})();
