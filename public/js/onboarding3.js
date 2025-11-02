// public/js/onboarding3.js
(function () {
  // =======================
  // ENDPOINTS (ajusta si cambian)
  // =======================
  const ENDPOINTS = {
    status:    '/api/onboarding/status',     // GET → { ok, sources: { google:{connected}, meta:{...}, ga4:{...}, shopify:{...} } }
    start:     '/api/audits/start',          // POST { sources: ['meta','google', ...] } → { ok, started: [...] }
    progress:  '/api/audits/progress'        // GET → { ok, overallPct, done, items: { meta:{state,pct,msg}, ... } }
  };

  // =======================
  // DOM refs
  // =======================
  const $ = (sel) => document.querySelector(sel);
  const progressBar = $('#progress-bar');          // <div id="progress-bar">
  const progressText = $('#progress-text');        // <p id="progress-text">
  const btnContinue = $('#btn-continue');          // <button id="btn-continue">

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
      if (ICON(row)) ICON(row).textContent = '●';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Analizando…';
    } else if (state === 'done') {
      row.classList.add('completed');
      if (ICON(row)) ICON(row).textContent = '✓';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Listo';
    } else if (state === 'skipped') {
      row.classList.add('opacity-50');
      if (ICON(row)) ICON(row).textContent = '○';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Omitido';
    } else if (state === 'error') {
      row.classList.add('error', 'opacity-50');
      if (ICON(row)) ICON(row).textContent = '!';
      if (BADGE(row)) BADGE(row).textContent = msg || 'Error';
    } else {
      if (ICON(row)) ICON(row).textContent = '○';
      if (BADGE(row)) BADGE(row).textContent = msg || '';
    }
  };

  // Ciclo de mensajes sutil para UX mientras corre
  const STATUS_MESSAGES = [
    'Conectando fuentes…',
    'Sincronizando permisos…',
    'Recopilando métricas…',
    'Analizando campañas…',
    'Detectando oportunidades…',
    'Generando recomendaciones…'
  ];
  let cyclerStop = null;
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

      // 1) Estado real de conexiones
      const st = await getJSON(ENDPOINTS.status);
      const sources = st?.sources || {};
      // Normalizamos flags (booleanos)
      const isConnected = {
        google:  !!sources.google?.connected,
        meta:    !!sources.meta?.connected,
        shopify: !!sources.shopify?.connected,
        ga4:     !!sources.ga4?.connected
      };

      // Marca omitidos los no conectados
      Object.entries(rows).forEach(([k, row]) => {
        if (!row) return;
        if (!isConnected[k]) {
          setRowState(row, { state: 'skipped', msg: 'No conectado' });
        } else {
          setRowState(row, { state: 'running', msg: 'Analizando…' });
        }
      });

      // Fuentes a procesar de verdad
      const toRun = Object.keys(isConnected).filter((k) => isConnected[k]);
      if (toRun.length === 0) {
        setBar(100);
        if (cyclerStop) cyclerStop();
        setText('No hay fuentes conectadas.');
        if (btnContinue) btnContinue.disabled = false;
        return;
      }

      // 2) Disparar auditorías en backend
      await postJSON(ENDPOINTS.start, { sources: toRun });

      // 3) Polling de progreso
      let finished = false;
      let lastSnapshot = null;

      async function poll() {
        try {
          const p = await getJSON(ENDPOINTS.progress);
          lastSnapshot = p;

          // overall
          const overall = Number(p?.overallPct ?? 0);
          setBar(overall);
          if (overall >= 100) {
            finished = true;
          }

          // por item
          const items = p?.items || {};
          for (const [key, row] of Object.entries(rows)) {
            if (!row) continue;
            const it = items[key];
            if (!isConnected[key]) continue; // ya está omitido

            if (!it) {
              setRowState(row, { state: 'running', msg: 'Analizando…' });
              continue;
            }

            const state = String(it.state || '').toLowerCase();
            const pct = typeof it.pct === 'number' ? Math.round(it.pct) : null;
            const label =
              state === 'running'
                ? (pct != null ? `Analizando… ${pct}%` : 'Analizando…')
                : (it.msg || '');

            if (state === 'running')      setRowState(row, { state: 'running', msg: label });
            else if (state === 'done')    setRowState(row, { state: 'done', msg: 'Listo' });
            else if (state === 'error')   setRowState(row, { state: 'error', msg: it.msg || 'Error' });
            else                          setRowState(row, { state: 'running', msg: 'Analizando…' });
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
          // marca error global, pero permite continuar para no bloquear
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
