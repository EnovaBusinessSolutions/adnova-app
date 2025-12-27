// public/js/onboarding3.js
(function () {
  const ENDPOINTS = {
    status:   "/api/onboarding/status",   // GET
    start:    "/api/audits/start",        // POST { types:[...], source:'onboarding' }
    progress: "/api/audits/progress",     // GET ?jobId=...
    latest:   "/api/audits/latest?type=all",
  };

  // =======================
  // Pixels (SAFE)
  // =======================
  const px = {
    gtag: (...args) => { try { window.gtag?.(...args); } catch {} },
    fbq:  (...args) => { try { window.fbq?.(...args); } catch {} },
    clarityEvent: (name) => { try { window.clarity?.("event", name); } catch {} },
    once: (key, fn) => {
      try {
        if (sessionStorage.getItem(key) === "1") return;
        fn?.();
        sessionStorage.setItem(key, "1");
      } catch {}
    },
  };

  // Step3 begin (una vez por sesión)
  px.once("px_onboarding_step3_begin", () => {
    px.gtag("event", "tutorial_progress", { step: 3, page: "onboarding3" });
    px.fbq("trackCustom", "OnboardingProgress", { step: 3 });
    px.clarityEvent("onboarding_step3_begin");
  });

  // =======================
  // Helpers HTTP
  // =======================
  function mergeDataShape(json) {
    // Soporta: payload plano, {ok:true,data:{...}}, {data:{...}} etc.
    if (!json || typeof json !== "object") return json;
    const d = json.data;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      // merge: preserva ok/error arriba, y trae campos dentro de data
      return { ...json, ...d };
    }
    return json;
  }

  async function getJSON(url) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    let j = {};
    try { j = await r.json(); } catch {}
    return mergeDataShape(j);
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

    const merged = mergeDataShape(j);

    if (!r.ok || merged?.ok === false) {
      const msg = merged?.error || j?.error || `HTTP_${r.status}`;
      const e = new Error(msg);
      e.detail = merged;
      throw e;
    }
    return merged;
  }

  // =======================
  // UI helpers
  // =======================
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const BASE_SUFFIX = {
    idle:    "",
    running: "Analizando…",
    done:    "Listo",
    skipped: "No conectado",
    error:   "Atención",
  };

  function setRowState(row, state = "idle", suffixOverride) {
    if (!row) return;

    row.classList.remove("active", "completed", "opacity-50", "is-current", "error");

    const suffix =
      typeof suffixOverride === "string" && suffixOverride.length
        ? suffixOverride
        : BASE_SUFFIX[state] || "";

    const badge = row.querySelector("[data-badge]");
    const icon  = row.querySelector(".analysis-step-icon");

    if (state === "running") {
      row.classList.add("active", "is-current");
      if (icon)  icon.textContent = "●";
      if (badge) badge.textContent = suffix;
    } else if (state === "done") {
      row.classList.add("completed");
      if (icon)  icon.textContent = "✓";
      if (badge) badge.textContent = suffix;
    } else if (state === "skipped") {
      row.classList.add("opacity-50");
      if (icon)  icon.textContent = "○";
      if (badge) badge.textContent = suffix;
    } else if (state === "error") {
      row.classList.add("error");
      if (icon)  icon.textContent = "!";
      if (badge) badge.textContent = suffix;
    } else {
      if (icon)  icon.textContent = "○";
      if (badge) badge.textContent = suffix;
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

  function startCycler(progressTextEl, setTextFn) {
    if (!progressTextEl) return () => {};
    let i = 0;
    let stop = false;

    const tick = () => {
      if (stop) return;
      progressTextEl.style.opacity = "0";
      setTimeout(() => {
        setTextFn(STATUS_MESSAGES[i % STATUS_MESSAGES.length]);
        progressTextEl.style.opacity = "1";
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

  function setContinueCTA(btn, mode) {
    if (!btn) return;

    // mode: "dashboard" | "select" | "back"
    if (mode === "select") {
      btn.disabled = false;
      btn.textContent = "Volver a seleccionar";
      btn.dataset.cta = "select";
      return;
    }
    if (mode === "back") {
      btn.disabled = false;
      btn.textContent = "Volver";
      btn.dataset.cta = "back";
      return;
    }
    // default dashboard
    btn.disabled = false;
    btn.textContent = "Continuar";
    btn.dataset.cta = "dashboard";
  }

  // =======================
  // Refresco desde Mongo (visual final)
  // =======================
  async function refreshAuditStatusFromDB(rows, isConnected) {
    try {
      const resp = await getJSON(ENDPOINTS.latest);

      // Puede venir como:
      // - { ok:true, data:{ google:..., meta:..., ga4:... } }
      // - { ok:true, items:[...] }
      // - { data:[...] }
      const dict =
        resp && resp.data && !Array.isArray(resp.data) ? resp.data :
        resp && !Array.isArray(resp) && typeof resp === "object" && !Array.isArray(resp.items) ? resp :
        {};

      const list =
        Array.isArray(resp?.items) ? resp.items :
        Array.isArray(resp?.data) ? resp.data :
        Array.isArray(resp) ? resp :
        [];

      const pick = (t) =>
        dict?.[t] ||
        list.find((x) => String(x?.type || "").toLowerCase() === t) ||
        null;

      const g  = pick("google");
      const m  = pick("meta");
      const ga = pick("ga4");

      const setFromDoc = (row, doc, key) => {
        if (!row) return;
        if (isConnected && isConnected[key] === false) return;
        if (!doc) return;

        const notAuth = !!doc?.inputSnapshot?.notAuthorized;
        if (notAuth) {
          setRowState(row, "error", "Sin permisos");
          return;
        }

        const hasSelectionRequired =
          Array.isArray(doc?.issues) &&
          doc.issues.some((x) => String(x?.id || "").startsWith("selection_required_"));

        if (hasSelectionRequired) {
          setRowState(row, "error", "Selección requerida");
          return;
        }

        const noDataSummary =
          typeof doc.summary === "string" &&
          /no hay datos suficientes|sin datos suficientes|sin datos recientes/i.test(doc.summary);

        if (Array.isArray(doc.issues) && doc.issues.length === 0 && noDataSummary) {
          setRowState(row, "skipped", "Sin datos recientes");
        } else {
          setRowState(row, "done");
        }
      };

      setFromDoc(rows.google, g, "google");
      setFromDoc(rows.meta,   m, "meta");
      setFromDoc(rows.ga4,    ga, "ga4");
    } catch (e) {
      console.warn("refreshAuditStatusFromDB error", e);
    }
  }

  // =======================
  // MAIN
  // =======================
  async function run() {
    const $ = (sel) => document.querySelector(sel);

    // DOM
    const progressBar  = $("#progress-bar");
    const progressText = $("#progress-text");
    const btnContinue  = $("#btn-continue");
    const progressWrap = document.querySelector(".progress-bar");

    const rows = {
      google:  $("#step-googleads"),
      meta:    $("#step-meta"),
      shopify: $("#step-shopify"),
      ga4:     $("#step-ga4"),
    };

    const setBar = (pct) => {
      const p = clamp(Number(pct) || 0, 0, 100);
      if (progressBar) progressBar.style.width = p + "%";
      if (progressWrap) progressWrap.setAttribute("aria-valuenow", String(p));
    };

    const setText = (t) => {
      if (progressText) progressText.textContent = t;
    };

    // CTA click (lo decidimos según el estado final)
    btnContinue?.addEventListener("click", () => {
      const mode = btnContinue?.dataset?.cta || "dashboard";
      if (mode === "select") {
        window.location.href = "/onboarding.html#step=1";
        return;
      }
      if (mode === "back") {
        window.location.href = "/onboarding2.html#step=2";
        return;
      }
      window.location.href = "/onboarding4.html";
    });

    let cyclerStop = null;
    let pollTimer = null;

    // Limpieza al salir
    const cleanup = () => {
      try { if (pollTimer) clearInterval(pollTimer); } catch {}
      try { cyclerStop?.(); } catch {}
      pollTimer = null;
      cyclerStop = null;
    };
    window.addEventListener("beforeunload", cleanup);

    try {
      if (btnContinue) btnContinue.disabled = true;
      if (btnContinue) btnContinue.textContent = "Procesando…";
      setBar(0);
      setText("Preparando análisis…");
      cyclerStop = startCycler(progressText, setText);

      // 1) Estado de conexiones
      const st = await getJSON(ENDPOINTS.status);
      const status = st?.status || st || {};

      // Normalizamos detección para no depender de un solo shape
      const isConnected = {
        google:  !!status?.googleAds?.connected || !!status?.google?.connected,
        meta:    !!status?.meta?.connected,
        shopify: !!status?.shopify?.connected,
        ga4:     !!status?.ga4?.connected,
      };

      // 2) Detectar “selection required” robusto
      const ga4Count =
        Number(status?.ga4?.propertiesCount || status?.ga4?.count || 0);

      const ga4Selected =
        (Array.isArray(status?.ga4?.selectedPropertyIds) && status.ga4.selectedPropertyIds.length > 0) ||
        !!String(status?.ga4?.defaultPropertyId || "").trim();

      const needsSelection = {
        google: !!status?.googleAds?.requiredSelection,
        meta:   !!status?.meta?.requiredSelection,
        // GA4: si hay más de 1 propiedad y no hay selección
        ga4: !!isConnected.ga4 && (ga4Count > 1) && !ga4Selected,
      };

      // 3) Pintar estado inicial de filas
      // Shopify: como está “Próximamente”, lo comunicamos mejor si no está conectado
      if (rows.shopify) {
        if (isConnected.shopify) setRowState(rows.shopify, "done", "Conectado");
        else setRowState(rows.shopify, "skipped", "Próximamente");
      }

      if (rows.google) {
        if (!isConnected.google) setRowState(rows.google, "skipped");
        else if (needsSelection.google) setRowState(rows.google, "error", "Selecciona 1 cuenta");
        else setRowState(rows.google, "running");
      }

      if (rows.meta) {
        if (!isConnected.meta) setRowState(rows.meta, "skipped");
        else if (needsSelection.meta) setRowState(rows.meta, "error", "Selecciona 1 cuenta");
        else setRowState(rows.meta, "running");
      }

      if (rows.ga4) {
        if (!isConnected.ga4) setRowState(rows.ga4, "skipped", "No conectado");
        else if (needsSelection.ga4) setRowState(rows.ga4, "error", "Selecciona 1 propiedad");
        else setRowState(rows.ga4, "running");
      }

      // 4) Definir qué se audita (solo conectadas y sin “selection required”)
      const types = [];
      if (isConnected.google && !needsSelection.google) types.push("google");
      if (isConnected.meta   && !needsSelection.meta)   types.push("meta");
      if (isConnected.ga4    && !needsSelection.ga4)    types.push("ga4");

      // Si no hay nada auditable…
      if (!types.length) {
        await refreshAuditStatusFromDB(rows, isConnected);
        setBar(100);
        cyclerStop?.();

        const anySelectionRequired =
          (isConnected.google && needsSelection.google) ||
          (isConnected.meta && needsSelection.meta) ||
          (isConnected.ga4 && needsSelection.ga4);

        if (anySelectionRequired) {
          setText("Falta seleccionar cuentas/propiedades para continuar.");
          setContinueCTA(btnContinue, "select");
        } else {
          setText("No hay fuentes conectadas para auditar.");
          setContinueCTA(btnContinue, "back");
        }

        // Tracking (safe) — análisis omitido
        px.gtag("event", "onboarding_analysis_skipped", { reason: anySelectionRequired ? "selection_required" : "no_sources" });
        px.fbq("trackCustom", "OnboardingAnalysisSkipped", { reason: anySelectionRequired ? "selection_required" : "no_sources" });
        px.clarityEvent("onboarding_analysis_skipped");

        return;
      }

      // 5) Arrancar job real (backend)
      setBar(10);

      // Tracking (safe) — comienza job
      px.gtag("event", "onboarding_analysis_start", { types: types.join(",") });
      px.fbq("trackCustom", "OnboardingAnalysisStart", { types });
      px.clarityEvent("onboarding_analysis_start");

      const startResp = await postJSON(ENDPOINTS.start, {
        types,
        source: "onboarding",
      });

      const jobId = startResp?.jobId;
      if (!jobId) throw new Error("NO_JOB_ID");

      // 6) Poll progreso
      const pollOnce = async () => {
        const prRaw = await getJSON(`${ENDPOINTS.progress}?jobId=${encodeURIComponent(jobId)}`);
        const pr = mergeDataShape(prRaw);

        if (pr?.ok === false) throw new Error(pr?.error || "PROGRESS_ERROR");

        // Barra
        const pct = Number(pr?.percent);
        setBar(Number.isFinite(pct) ? pct : 55);

        // Estados por item
        const items = pr?.items || pr?.progress || {};
        if (items && typeof items === "object") {
          Object.keys(items).forEach((t) => {
            const it = items[t];
            const row = rows[t];
            if (!row) return;

            const stt = String(it?.status || "").toLowerCase();
            if (stt === "pending" || stt === "running") {
              setRowState(row, "running");
              return;
            }
            if (stt === "done" || stt === "finished") {
              if (it?.ok === false) setRowState(row, "error", it?.error ? "Advertencia" : "Atención");
              else setRowState(row, "done");
            }
          });
        }

        // Termina
        if (pr?.finished || pr?.done) {
          cleanup();

          // Estado final desde DB
          await refreshAuditStatusFromDB(rows, isConnected);

          setBar(100);
          setText("¡Análisis completado!");
          setContinueCTA(btnContinue, "dashboard");

          // Snapshot opcional
          try {
            const latest = await getJSON(ENDPOINTS.latest);
            sessionStorage.setItem("auditLatest", JSON.stringify(latest || {}));
          } catch {}

          // Tracking (safe) — listo
          px.gtag("event", "onboarding_analysis_complete", { types: types.join(",") });
          px.fbq("trackCustom", "OnboardingAnalysisComplete", { types });
          px.clarityEvent("onboarding_analysis_complete");
        }
      };

      // poll inicial + intervalo
      await pollOnce();

      pollTimer = setInterval(() => {
        pollOnce().catch((e) => {
          console.warn("progress poll error", e);
          // si falla 1 vez, no matamos todo el flow
        });
      }, 1100);

    } catch (e) {
      console.error("ONBOARDING3_INIT_ERROR", e);
      cleanup();

      // fail-safe UI
      setText("Error iniciando el análisis");
      setBar(100);

      // Google / Meta / GA4 -> error (Shopify lo dejamos como está)
      if (rows.google) setRowState(rows.google, "error");
      if (rows.meta)   setRowState(rows.meta, "error");
      if (rows.ga4)    setRowState(rows.ga4, "error");

      // CTA para volver y no perder al usuario
      setContinueCTA(btnContinue, "back");

      // Tracking (safe)
      px.gtag("event", "onboarding_analysis_error", { error: String(e?.message || "unknown") });
      px.fbq("trackCustom", "OnboardingAnalysisError", { error: String(e?.message || "unknown") });
      px.clarityEvent("onboarding_analysis_error");
    }
  }

  document.addEventListener("DOMContentLoaded", run);
})();
