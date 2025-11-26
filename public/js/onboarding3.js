// public/js/onboarding3.js
(function () {
  // =======================
  // ENDPOINTS
  // =======================
  const ENDPOINTS = {
    status: "/api/onboarding/status", // GET
    run: "/api/audits/run",           // POST { source: 'onboarding', ... }
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
  const setBar = (pct) => {
    if (progressBar) progressBar.style.width = clamp(pct, 0, 100) + "%";
  };
  const setText = (t) => {
    if (progressText) progressText.textContent = t;
  };

  // Sufijos base (el label estático del paso queda en el HTML)
  const BASE_SUFFIX = {
    idle:    "",
    running: "Analizando…",
    done:    "Listo",
    skipped: "No conectado",
    error:   "Error",
  };

  // Idempotente: siempre sobrescribe icono y badge (sin concatenar)
  function setRowState(row, state = "idle", suffixOverride) {
    if (!row) return;
    row.classList.remove("active", "completed", "opacity-50", "is-current", "error");

    const suffix =
      typeof suffixOverride === "string" && suffixOverride.length
        ? suffixOverride
        : BASE_SUFFIX[state] || "";

    if (state === "running") {
      row.classList.add("active", "is-current");
      if (ICON(row))  ICON(row).textContent = "●";
      if (BADGE(row)) BADGE(row).textContent = suffix;
    } else if (state === "done") {
      row.classList.add("completed");
      if (ICON(row))  ICON(row).textContent = "✓";
      if (BADGE(row)) BADGE(row).textContent = suffix;
    } else if (state === "skipped") {
      row.classList.add("opacity-50");
      if (ICON(row))  ICON(row).textContent = "○";
      if (BADGE(row)) BADGE(row).textContent = suffix;
    } else if (state === "error") {
      row.classList.add("error", "opacity-50");
      if (ICON(row))  ICON(row).textContent = "!";
      if (BADGE(row)) BADGE(row).textContent = suffix;
    } else {
      if (ICON(row))  ICON(row).textContent = "○";
      if (BADGE(row)) BADGE(row).textContent = suffix;
    }
  }

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
    let i = 0;
    let stop = false;

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
    return () => {
      stop = true;
      clearInterval(id);
    };
  }

  let cyclerStop = null;

  // =======================
  // HTTP helpers
  // =======================
  async function getJSON(url) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    let j = {};
    try { j = await r.json(); } catch {}
    return j;
  }

  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
  // Refresco desde BD (pinta filas según últimas auditorías)
  // =======================
  async function refreshAuditStatusFromDB() {
    try {
      const resp = await getJSON("/api/audits/latest?type=all");

      // Soportamos dos formatos:
      // 1) { ok:true, data:{google,meta,ga4} }
      // 2) { ok:true, items:[...] } / { ok:true, data:[...] }
      const dict =
        resp?.data && !Array.isArray(resp.data) ? resp.data : {};
      const list = Array.isArray(resp?.items)
        ? resp.items
        : Array.isArray(resp?.data)
        ? resp.data
        : [];

      const pick = (t) =>
        dict[t] ||
        list.find((x) => String(x?.type).toLowerCase() === t) ||
        null;

      const g  = pick("google");
      const m  = pick("meta");
      const ga = pick("ga4");

      const setFromDoc = (row, doc) => {
        if (!row || !doc) return;
        const notAuth = !!doc?.inputSnapshot?.notAuthorized;

        // Sin permisos → lo marcamos como error suave
        if (notAuth) {
          setRowState(row, "error", "Sin permisos");
          return;
        }

        const noDataSummary =
          typeof doc.summary === "string" &&
          /no hay datos suficientes|no hay datos suficientes para auditar|no hay datos suficientes en el periodo/i.test(
            doc.summary
          );

        if (Array.isArray(doc.issues) && doc.issues.length === 0 && noDataSummary) {
          setRowState(row, "skipped", "Sin datos recientes");
        } else {
          setRowState(row, "done");
        }
      };

      setFromDoc(rows.google, g);
      setFromDoc(rows.meta,   m);
      setFromDoc(rows.ga4,    ga);
      // Shopify no tiene auditoría en Mongo, se deja como estaba (visual)
    } catch (e) {
      console.warn("refreshAuditStatusFromDB error", e);
    }
  }

  // =======================
  // Main
  // =======================
  async function run() {
    let progressTimer = null;

    try {
      if (btnContinue) btnContinue.disabled = true;
      setBar(0);
      setText("Preparando análisis…");
      cyclerStop = startCycler();

      // 1) Estado real de conexiones
      const st = await getJSON(ENDPOINTS.status);
      const status = st?.status || {};

      const isConnected = {
        google:
          !!status.googleAds?.connected || !!status.google?.connected, // compat
        meta: !!status.meta?.connected,
        shopify: !!status.shopify?.connected,
        ga4: !!status.ga4?.connected,
      };

      // 2) Pinta estado inicial de filas
      Object.entries(rows).forEach(([k, row]) => {
        if (!row) return;

        if (k === "shopify") {
          // Shopify: solo visual (no hay auditoría IA oficial aún)
          if (isConnected.shopify) {
            setRowState(row, "done", "Conectado");
          } else {
            setRowState(row, "skipped");
          }
          return;
        }

        if (k === "ga4") {
          if (isConnected.ga4) {
            setRowState(row, "running");
          } else {
            setRowState(row, "skipped", "Opcional");
          }
          return;
        }

        // Google Ads / Meta
        if (!isConnected[k]) {
          setRowState(row, "skipped");
        } else {
          setRowState(row, "running");
        }
      });

      // Fuentes con auditoría IA real que esperamos analizar
      const toAudit = [];
      if (isConnected.google) toAudit.push("google");
      if (isConnected.meta)   toAudit.push("meta");
      if (isConnected.ga4)    toAudit.push("ga4");

      if (toAudit.length === 0) {
        await refreshAuditStatusFromDB();
        setBar(100);
        if (cyclerStop) cyclerStop();
        setText("No hay fuentes conectadas para auditar.");
        if (btnContinue) btnContinue.disabled = false;
        return;
      }

      // 3) Simulación de progreso mientras corre /api/audits/run
      let logicalPct = 10;
      setBar(logicalPct);

      progressTimer = setInterval(() => {
        logicalPct = Math.min(logicalPct + 7, 85); // nunca pasa de 85% hasta que termine
        setBar(logicalPct);
      }, 1200);

      // 4) Disparar auditorías IA (Google, Meta, GA4) con origen 'onboarding'
      let runResp = null;
      try {
        runResp = await postJSON(ENDPOINTS.run, {
          source: "onboarding",
          // Estas flags las usa el backend para decidir qué fuentes procesar
          googleConnected: isConnected.google,
          metaConnected:   isConnected.meta,
        });
      } catch (e) {
        console.warn("No se pudo ejecutar /api/audits/run:", e?.message || e);
        throw e;
      } finally {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      }

      // 5) Refrescar filas desde Mongo en base a las últimas auditorías
      await refreshAuditStatusFromDB();

      // Shopify: si estaba conectado, lo marcamos como listo
      if (rows.shopify && isConnected.shopify) {
        setRowState(rows.shopify, "done", "Conectado");
      }

      // 6) Cálculo final de progreso en función de filas completadas
      const doneCount = toAudit.reduce((acc, key) => {
        const row = rows[key];
        if (!row) return acc;
        return acc + (row.classList.contains("completed") ? 1 : 0);
      }, 0);

      const finalPct = toAudit.length
        ? Math.round((doneCount / toAudit.length) * 100)
        : 100;

      setBar(100);

      if (cyclerStop) cyclerStop();
      if (doneCount === toAudit.length) {
        setText("¡Análisis completado!");
      } else {
        setText("Análisis finalizado (con advertencias).");
      }

      // Guardamos una foto rápida por si la quieres usar luego
      try {
        const latest = await getJSON("/api/audits/latest?type=all");
        sessionStorage.setItem(
          "auditLatest",
          JSON.stringify(latest || {})
        );
      } catch {}

      if (btnContinue) btnContinue.disabled = false;
    } catch (e) {
      console.error("ONBOARDING3_INIT_ERROR", e);
      if (progressTimer) clearInterval(progressTimer);
      if (cyclerStop) cyclerStop();

      setText("Error iniciando el análisis");
      setBar(100);
      Object.values(rows).forEach(
        (row) => row && setRowState(row, "error")
      );
      if (btnContinue) btnContinue.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", run);

  // Navegación
  btnContinue?.addEventListener("click", () => {
    window.location.href = "/onboarding4.html";
  });
})();
