// public/js/onboarding3.js
(function () {
  // =======================
  // ENDPOINTS
  // =======================
  const ENDPOINTS = {
    status:   '/api/onboarding/status', // GET → { ok, status:{ meta:{connected,count}, google:{connected,count}, shopify:{connected}, ... } }
    start:    '/api/audits/start',      // POST { types: ['meta','google','shopify'] } → { ok, jobId }
    progress: '/api/audits/progress'    // GET  ?jobId=... → { ok, items:{...}, percent, finished }
  };

  // =======================
  // DOM refs
  // =======================
  const $ = (sel) => document.querySelector(sel);
  const progressBar = $('#progress-bar');
  const progressText = $('#progress-text');
  const btnContinue = $('#btn-continue');

  const rows = {
    google:  $('#step-googleads'),
    meta:    $('#step-meta'),
    shopify: $('#step-shopify'),
    ga4:     $('#step-ga4'),
  };

  const BADGE = (row) => row?.querySelector('[data-badge]');
  const ICON  = (row) => row?.querySelector('.analysis-step-icon');

  // =======================
  // Helpers UI
  // =======================
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const setBar = (pct) => { if (progressBar) progressBar.style.width = clamp(pct, 0, 100) + '%'; };
  const setText = (t) => { if (progressText) progressText.textContent = t; };

  const setRowState = (row, { state = 'idle', msg = '' } = {}) => {
    if (!row) return;
    // estados: idle | running | done | skipped | error
    row.classList.remove('active', 'completed', 'opacity-50', 'is-current', 'error');
    if (state === 'running') {
      row.classList.add('active', 'is-current');
      if (ICON(row))   ICON(row).textContent = '●';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Analizando…';
    } else if (state === 'done') {
      row.classList.add('completed');
      if (ICON(row))   ICON(row).textContent = '✓';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Listo';
    } else if (state === 'skipped') {
      row.classList.add('opacity-50');
      if (ICON(row))   ICON(row).textContent = '○';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Omitido';
    } else if (state === 'error') {
      row.classList.add('error', 'opacity-50');
      if (ICON(row))   ICON(row).textContent = '!';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Error';
    } else {
      if (ICON(row))   ICON(row).textContent = '○';
      if (BADGE(row)) BADGE(row).textContent = msg || '';
    }
  };

  // Ciclo de mensajes UX mientras corre
  const STATUS_MESSAGES = [
    'Conectando fuentes…',
    'Sincronizando permisos…',
    'Recopilando métricas…',
    'Analizando campañas…',
    'Detectando oportunidades…',
    'Generando recomendaciones…'
  ];
  function startCycler() {
    if (!progressText) return () => {};
    let i = 0, stop = false;
    const tick = () => {
      if (stop) return;
      progressText.style.opacity = '0';
      setTimeout(() => {
        setText(STATUS_MESSAGES[i % STATUS_MESSAGES.length]);
        progressText.style.opacity = '1';
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
    const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    let j = {};
    try { j = await r.json(); } catch {}
    return j;
  }
  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
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
  // Main
  // =======================
  async function run() {
    try {
      if (btnContinue) btnContinue.disabled = true;
      setBar(0);
      setText('Preparando análisis…');
      cyclerStop = startCycler();

      // 1) Estado real de conexiones (lee /api/onboarding/status → { ok, status:{...} })
      const st = await getJSON(ENDPOINTS.status);
      const status = st?.status || {};
      // Normaliza flags
      // GA4 se considera conectado si Google está conectado y hay propiedades (count>0)
      const isConnected = {
        google:  !!status.google?.connected,
        meta:    !!status.meta?.connected,
        shopify: !!status.shopify?.connected,
        ga4:     !!status.google?.connected && Number(status.google?.count || 0) > 0
      };

      // Pinta estado inicial por fila
      Object.entries(rows).forEach(([k, row]) => {
        if (!row) return;
        if (!isConnected[k]) {
          const msg = (k === 'ga4')
            ? (!!status.google?.connected ? 'Conecta GA4' : 'No conectado')
            : 'No conectado';
          setRowState(row, { state: 'skipped', msg });
        } else {
          setRowState(row, { state: 'running', msg: 'Analizando…' });
        }
      });

      // Fuentes a procesar realmente
      const toRun = Object.keys(isConnected).filter((k) => isConnected[k] && (k === 'google' || k === 'meta' || k === 'shopify'));
      if (toRun.length === 0) {
        setBar(100);
        if (cyclerStop) cyclerStop();
        setText('No hay fuentes conectadas.');
        if (btnContinue) btnContinue.disabled = false;
        return;
      }

      // 2) Disparar auditorías (el backend espera "types")
      const startResp = await postJSON(ENDPOINTS.start, { types: toRun });
      const jobId = startResp?.jobId;
      if (!jobId) {
        // fallback: permite continuar aunque no haya jobId
        console.warn('No jobId from /audits/start; continuaré sin polling específico.');
      }

      // 3) Polling de progreso (soporta las dos formas de respuesta)
      let finished = false;
      let lastSnapshot = null;

      async function poll() {
        try {
          const q = jobId ? `${ENDPOINTS.progress}?jobId=${encodeURIComponent(jobId)}` : ENDPOINTS.progress;
          const p = await getJSON(q);
          lastSnapshot = p;

          // overall percent (acepta overallPct o percent)
          const overall = Number(
            (p && (p.overallPct ?? p.percent)) ?? 0
          );
          setBar(overall);
          if (overall >= 100 || p?.finished === true) {
            finished = true;
          }

          // items por fuente (acepta estructura flexible)
          const items = p?.items || {};
          for (const [key, row] of Object.entries(rows)) {
            if (!row) continue;
            if (!isConnected[key]) continue;

            const it = items[key];
            if (!it) {
              setRowState(row, { state: 'running', msg: 'Analizando…' });
              continue;
            }

            // Compat: it.status | it.state; it.pct | it.percent
            const stateRaw = (it.state || it.status || '').toString().toLowerCase();
            const pct = typeof it.pct === 'number'
              ? Math.round(it.pct)
              : (typeof it.percent === 'number' ? Math.round(it.percent) : null);

            let state = 'running';
            if (stateRaw === 'done') state = 'done';
            else if (stateRaw === 'error') state = 'error';
            else if (stateRaw === 'pending') state = 'running';

            const label =
              state === 'running'
                ? (pct != null ? `Analizando… ${pct}%` : 'Analizando…')
                : (it.msg || (state === 'done' ? 'Listo' : 'Error'));

            setRowState(row, { state, msg: label });
          }

          if (!finished) {
            setTimeout(poll, 1200);
          } else {
            if (cyclerStop) cyclerStop();
            setText('¡Análisis completado!');
            setBar(100);
            if (btnContinue) btnContinue.disabled = false;
            try { sessionStorage.setItem('auditProgressSnapshot', JSON.stringify(lastSnapshot || {})); } catch {}
          }
        } catch (e) {
          console.warn('Polling error', e);
          if (cyclerStop) cyclerStop();
          setText('Hubo un problema al analizar. Puedes continuar.');
          setBar(100);
          Object.values(rows).forEach((row) => {
            if (!row) return;
            if (!row.classList.contains('completed') && !row.classList.contains('opacity-50')) {
              setRowState(row, { state: 'error', msg: 'Error' });
            }
          });
          if (btnContinue) btnContinue.disabled = false;
        }
      }

      poll();
    } catch (e) {
      console.error('ONBOARDING3_INIT_ERROR', e);
      if (cyclerStop) cyclerStop();
      setText('Error iniciando el análisis');
      setBar(100);
      Object.values(rows).forEach((row) => row && setRowState(row, { state: 'error', msg: 'Error' }));
      if (btnContinue) btnContinue.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', run);

  // Navegación
  btnContinue?.addEventListener('click', () => {
    window.location.href = '/onboarding4.html';
  });
})();
