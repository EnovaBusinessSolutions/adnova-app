// public/js/onboarding3.js
(function () {
  const ENDPOINTS = {
    status:   "/api/onboarding/status",  // GET
    start:    "/api/audits/start",       // POST { types:[...], source:'onboarding' }
    progress: "/api/audits/progress",    // GET ?jobId=...
    latest:   "/api/audits/latest?type=all",
  };

  // =======================
  // Helpers HTTP
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

  // =======================
  // Refresco desde Mongo (visual final)
  // =======================
  async function refreshAuditStatusFromDB(rows, isConnected) {
    try {
      const resp = await getJSON(ENDPOINTS.latest);

      const dict = resp?.data && !Array.isArray(resp.data) ? resp.data : {};
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

      const setFromDoc = (row, doc, key) => {
        if (!row) return;
        if (isConnected && isConnected[key] === false) return;
        if (!doc) return;

        const notAuth = !!doc?.inputSnapshot?.notAuthorized;
        if (notAuth) {
          setRowState(row, "error", "Sin permisos");
          return;
        }

        // 👇 si el backend guardó el issue “selection_required_*”
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

    // DOM (ya con DOM listo)
    const progressBar  = $("#progress-bar");
    const progressText = $("#progress-text");
    const btnContinue  = $("#btn-continue");

    const rows = {
      google:  $("#step-googleads"),
      meta:    $("#step-meta"),
      shopify: $("#step-shopify"),
      ga4:     $("#step-ga4"),
    };

    const setBar = (pct) => {
      if (progressBar) progressBar.style.width = clamp(pct, 0, 100) + "%";
    };
    const setText = (t) => {
      if (progressText) progressText.textContent = t;
    };

    // Navigation (asegurar listener)
    btnContinue?.addEventListener("click", () => {
      window.location.href = "/onboarding4.html";
    });

    let cyclerStop = null;
    let pollTimer = null;

    try {
      if (btnContinue) btnContinue.disabled = true;
      setBar(0);
      setText("Preparando análisis…");
      cyclerStop = startCycler(progressText, setText);

      // 1) Estado de conexiones
      const st = await getJSON(ENDPOINTS.status);
      const status = st?.status || {};

      const isConnected = {
        google:  !!status.googleAds?.connected || !!status.google?.connected,
        meta:    !!status.meta?.connected,
        shopify: !!status.shopify?.connected,
        ga4:     !!status.ga4?.connected,
      };

      // 2) Detectar “selection required”
      const needsSelection = {
        google: !!status.googleAds?.requiredSelection,
        meta:   !!status.meta?.requiredSelection,
        // ga4: el endpoint actual no lo expone; inferimos:
        ga4:
          !!status.ga4?.connected &&
          (Number(status.ga4?.propertiesCount || 0) > 3) &&
          !String(status.ga4?.defaultPropertyId || "").trim(),
      };

      // 3) Pintar estado inicial de filas
      // Shopify (solo visual)
      if (rows.shopify) {
        if (isConnected.shopify) setRowState(rows.shopify, "done", "Conectado");
        else setRowState(rows.shopify, "skipped");
      }

      // Google / Meta / GA4
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
        if (cyclerStop) cyclerStop();

        if (
          (isConnected.google && needsSelection.google) ||
          (isConnected.meta && needsSelection.meta) ||
          (isConnected.ga4 && needsSelection.ga4)
        ) {
          setText("Falta seleccionar cuentas/propiedades para continuar.");
        } else {
          setText("No hay fuentes conectadas para auditar.");
        }

        if (btnContinue) btnContinue.disabled = false;
        return;
      }

      // 5) Arrancar job real (backend)
      setBar(10);
      const startResp = await postJSON(ENDPOINTS.start, {
        types,
        source: "onboarding",
      });

      const jobId = startResp?.jobId;
      if (!jobId) throw new Error("NO_JOB_ID");

      // 6) Poll progreso
      const pollOnce = async () => {
        const pr = await getJSON(`${ENDPOINTS.progress}?jobId=${encodeURIComponent(jobId)}`);
        if (!pr?.ok) throw new Error(pr?.error || "PROGRESS_ERROR");

        // Barra
        const pct = typeof pr.percent === "number" ? pr.percent : 50;
        setBar(clamp(pct, 0, 100));

        // Estados por item
        const items = pr.items || {};
        Object.keys(items).forEach((t) => {
          const it = items[t];
          const row = rows[t];
          if (!row) return;

          if (it.status === "pending" || it.status === "running") {
            setRowState(row, "running");
            return;
          }
          if (it.status === "done") {
            if (it.ok) setRowState(row, "done");
            else setRowState(row, "error", "Advertencia");
          }
        });

        // Termina
        if (pr.finished) {
          clearInterval(pollTimer);
          pollTimer = null;

          // Estado final desde DB (la “verdad”)
          await refreshAuditStatusFromDB(rows, isConnected);

          setBar(100);
          if (cyclerStop) cyclerStop();

          // Mensaje final
          const completed = types.filter((t) => rows[t]?.classList.contains("completed")).length;
          if (completed === types.length) setText("¡Análisis completado!");
          else setText("Análisis finalizado (con advertencias).");

          // Snapshot en sessionStorage (opcional)
          try {
            const latest = await getJSON(ENDPOINTS.latest);
            sessionStorage.setItem("auditLatest", JSON.stringify(latest || {}));
          } catch {}

          if (btnContinue) btnContinue.disabled = false;
        }
      };

      // poll rápido
      await pollOnce();
      pollTimer = setInterval(() => {
        pollOnce().catch((e) => {
          console.warn("progress poll error", e);
        });
      }, 1100);

    } catch (e) {
      console.error("ONBOARDING3_INIT_ERROR", e);

      // fail-safe UI
      if (pollTimer) clearInterval(pollTimer);
      if (cyclerStop) cyclerStop();

      const $ = (sel) => document.querySelector(sel);
      const progressBar  = $("#progress-bar");
      const progressText = $("#progress-text");
      const btnContinue  = $("#btn-continue");

      if (progressText) progressText.textContent = "Error iniciando el análisis";
      if (progressBar)  progressBar.style.width = "100%";

      // no reventar Shopify visual si existe
      ["google", "meta", "ga4"].forEach((k) => {
        const row = document.querySelector(
          k === "google" ? "#step-googleads" :
          k === "meta"   ? "#step-meta" :
          "#step-ga4"
        );
        if (row) setRowState(row, "error");
      });

      if (btnContinue) btnContinue.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", run);
})();
