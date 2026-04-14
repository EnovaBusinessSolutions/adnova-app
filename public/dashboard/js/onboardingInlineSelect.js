// dashboard-src/public/js/onboardingInlineSelect.js
'use strict';

/**
 * =========================================================
 * ✅ Guard anti doble-carga (E2E)
 * - Si el script se inyecta 2 veces, no vuelve a ejecutar nada.
 * - IMPORTANTE: este guard debe existir UNA SOLA VEZ.
 * =========================================================
 */
(function () {
  try {
    if (window.__ADNOVA_ASM_LOADED__) return;
    window.__ADNOVA_ASM_LOADED__ = true;
  } catch {
    // noop
  }

  /* =========================================================
   * Helpers fetch JSON / POST
   * =======================================================*/
  async function _json(u) {
    const r = await fetch(u, { credentials: 'include' });
    const txt = await r.text();
    if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
    return txt ? JSON.parse(txt) : {};
  }

  async function _post(u, b) {
    const r = await fetch(u, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b || {}),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
    return txt ? JSON.parse(txt) : {};
  }

  /* =========================================================
   * Config
   * =======================================================*/
  var MAX_SELECT = 1; // ✅ var dentro de IIFE: no colisiona aunque haya doble load

  /* =========================================================
   * Normalizers (alineado con backend)
   * =======================================================*/
  const normActId = (s = '') => String(s || '').trim().replace(/^act_/, '');
  const normGadsId = (s = '') =>
    String(s || '')
      .replace(/^customers\//, '')
      .replace(/[^\d]/g, '')
      .trim();

  // GA4: devolvemos solo dígitos para comparar, pero guardamos RAW en selección
  const normGA4Id = (s = '') => {
    const raw = String(s || '').trim();
    const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
    return digits || raw.replace(/^properties\//, '').trim();
  };

  const safeStr = (v) => String(v || '').trim();

  /* =========================================================
   * State (accounts + pixels + wizard)
   * =======================================================*/
  const ASM = {
    mode: 'settings',
    force: true,
    only: 'all', // accounts: all|meta|googleAds|googleGa  pixels: metaPixel|googleConversion
    showAll: false,

    data: {
      meta: [],
      googleAds: [],
      googleGa: [],

      // pixels
      metaPixels: [],
      googleConversions: [],
      metaPixelsMeta: { adAccountId: '' },
      googleConversionsMeta: { customerId: '' },
      metaPixelsRecommendedId: null,
      googleConversionsRecommendedResource: null,
    },

    // selected
    sel: {
      meta: new Set(),
      googleAds: new Set(),
      googleGa: new Set(),

      // pixels (MAX_SELECT=1 => Set para reusar UX)
      metaPixel: new Set(), // pixelId
      googleConversion: new Set(), // resourceName
    },

    visible: {
      meta: false,
      googleAds: false,
      googleGa: false,

      // pixels (wizard)
      metaPixel: false,
      googleConversion: false,
    },

    required: {
      meta: false,
      googleAds: false,
      googleGa: false,

      // pixels
      metaPixel: false,
      googleConversion: false,
    },

    // helper runtime
    _isGoogleGaChecked: null,

    // ✅ Flow/wizard runtime inside Account Modal
    flow: {
      next: null, // null | 'metaPixel' | 'googleConversion'
      step: 'A', // 'A' | 'B' | 'C'
    },
  };

  /* =========================================================
   * UI utils (FIX: no romper modal, no mezclar show/hide)
   * =======================================================*/
  const _el = (id) => document.getElementById(id);

  function _showEl(el) {
    if (!el) return;
    el.classList.remove('hidden');
    el.style.display = 'block';
  }
  function _hideEl(el) {
    if (!el) return;
    el.classList.add('hidden');
    el.style.display = 'none';
  }

  function _openModalEl(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('asm-open');
    modal.style.display = 'block';
    document.body.classList.add('asm-lock');
  }
  function _closeModalEl(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('asm-open');
    modal.style.display = 'none';
    document.body.classList.remove('asm-lock');
  }

  function _ensureHintNode(modalId) {
    const hintId = modalId === 'pixel-select-modal' ? 'pxm-hint' : 'asm-hint';
    let hint = _el(hintId);
    if (!hint) {
      const panel = _el(modalId)?.querySelector('.asm-panel');
      if (panel) {
        hint = document.createElement('div');
        hint.id = hintId;
        hint.style.margin = '10px 0 0';
        hint.style.fontSize = '.9rem';
        hint.style.opacity = '0.9';
        panel.insertBefore(hint, panel.querySelector('.asm-footer'));
      }
    }
    return hint;
  }

  function _hint(text, type = 'info', modalId = 'account-select-modal') {
    const box = _ensureHintNode(modalId);
    if (!box) return;

    box.textContent = text || '';
    box.style.color =
      type === 'warn' ? '#f59e0b' : type === 'error' ? '#ef4444' : '#a1a1aa';

    text ? _showEl(box) : _hideEl(box);
  }

  function _enableSave(enabled, btnId) {
    const btn = _el(btnId);
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('asm-btn-primary--disabled', !enabled);
  }

  function _countFor(kind) {
    if (kind === 'googleGa') return ASM.sel.googleGa.size ? 1 : 0;
    return ASM.sel[kind].size;
  }

  function _chip(label, value, kind, checked, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'asm-chip';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = value;
    cb.checked = !!checked;

    cb.addEventListener('change', () => onChange(!!cb.checked, value, kind, cb));

    wrap.appendChild(cb);

    const txt = document.createElement('span');
    txt.className = 'asm-chip-text';
    txt.textContent = label || value || '';
    wrap.appendChild(txt);

    return wrap;
  }

  /* =========================================================
   * ✅ Exit confirm (inline overlay inside modal)
   * =======================================================*/
  function _ensureExitConfirm(modalId) {
    const modal = _el(modalId);
    if (!modal) return null;

    let overlay = modal.querySelector('#asm-exit-confirm');
    if (overlay) return overlay;

    const panel = modal.querySelector('.asm-panel');
    if (!panel) return null;

    overlay = document.createElement('div');
    overlay.id = 'asm-exit-confirm';
    overlay.className = 'hidden';
    overlay.innerHTML = `
      <div class="asm-exit-backdrop" data-exit-backdrop="1"></div>
      <div class="asm-exit-card" role="dialog" aria-modal="true" aria-label="Confirm exit">
        <div class="asm-exit-title">Are you sure you want to leave?</div>
        <div class="asm-exit-sub">
          If you leave now, you’ll lose your onboarding progress.
        </div>

        <div class="asm-exit-actions">
          <button class="asm-btn" id="asm-exit-cancel">Stay</button>
          <button class="asm-btn asm-btn-primary" id="asm-exit-leave">Leave & reset</button>
        </div>
        <div class="asm-exit-foot">This will clear the data sources you already connected.</div>
      </div>
    `;

    panel.appendChild(overlay);
    return overlay;
  }

  function _isExitConfirmOpen(modalId) {
    const modal = _el(modalId);
    const overlay = modal?.querySelector('#asm-exit-confirm');
    return !!overlay && !overlay.classList.contains('hidden') && overlay.style.display !== 'none';
  }

  function _openExitConfirm(modalId) {
    const overlay = _ensureExitConfirm(modalId);
    if (!overlay) return;

    overlay.classList.remove('hidden');
    overlay.style.display = 'block';

    const btn = overlay.querySelector('#asm-exit-cancel');
    if (btn && btn.focus) btn.focus();

    const cancelBtn = overlay.querySelector('#asm-exit-cancel');
    const leaveBtn = overlay.querySelector('#asm-exit-leave');

    if (cancelBtn && !cancelBtn.__asmBound) {
      cancelBtn.__asmBound = true;
      cancelBtn.addEventListener('click', () => _closeExitConfirm(modalId));
    }

    if (leaveBtn && !leaveBtn.__asmBound) {
      leaveBtn.__asmBound = true;
      leaveBtn.addEventListener('click', async () => {
        await _leaveAndReset(modalId);
      });
    }

    const exitBackdrop = overlay.querySelector('[data-exit-backdrop="1"]');
    if (exitBackdrop && !exitBackdrop.__asmBound) {
      exitBackdrop.__asmBound = true;
      exitBackdrop.addEventListener('click', () => {
        _shakeModal(modalId);
        _hint('Finish onboarding or tap “Stay”.', 'warn', modalId);
      });
    }
  }

  function _closeExitConfirm(modalId) {
    const modal = _el(modalId);
    const overlay = modal?.querySelector('#asm-exit-confirm');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }

  function _shakeModal(modalId) {
    const modal = _el(modalId);
    const panel = modal?.querySelector('.asm-panel');
    if (!panel) return;

    panel.classList.remove('asm-shake');
    void panel.offsetWidth;
    panel.classList.add('asm-shake');

    window.setTimeout(() => {
      panel.classList.remove('asm-shake');
    }, 420);
  }

  async function _leaveAndReset(modalId) {
    const modal = _el(modalId);
    const overlay = modal?.querySelector('#asm-exit-confirm');
    const leaveBtn = overlay?.querySelector('#asm-exit-leave');

    try {
      if (leaveBtn) {
        leaveBtn.disabled = true;
        leaveBtn.textContent = 'Resetting…';
      }

      try {
        const target =
  ASM.flow?.next === 'metaPixel'
    ? 'meta'
    : ASM.flow?.next === 'googleConversion'
    ? 'google_ads'
    : 'all';

await _post('/api/onboarding/reset', { source: 'asm', target });
      } catch {
        // noop
      }

      _closeExitConfirm(modalId);
      if (modal) _closeModalEl(modal);

      window.dispatchEvent(new CustomEvent('adray:onboarding-reset', { detail: { source: 'asm' } }));
    } finally {
      if (leaveBtn) {
        leaveBtn.disabled = false;
        leaveBtn.textContent = 'Leave & reset';
      }
    }
  }

  /* =========================================================
   * ✅ Inyectar modales + estilos si NO existen
   * =======================================================*/
  function _ensureStyles() {
    if (document.getElementById('asm-styles')) return;

    const style = document.createElement('style');
    style.id = 'asm-styles';
    style.textContent = `
      :root{
        --asm-bg: rgba(4,4,8,.70);
        --asm-panel: linear-gradient(180deg, rgba(18,14,28,.76) 0%, rgba(10,10,16,.90) 100%);
        --asm-surface: linear-gradient(180deg, rgba(18,14,28,.68) 0%, rgba(11,11,16,.82) 100%);
        --asm-surface-2: linear-gradient(180deg, rgba(15,14,22,.86) 0%, rgba(8,9,13,.88) 100%);
        --asm-border: rgba(255,255,255,.08);
        --asm-border-soft: rgba(255,255,255,.05);
        --asm-text: rgba(239,235,249,.96);
        --asm-muted: rgba(181,174,199,.82);
        --asm-purple: #b55cff;
        --asm-purple-2: #c87cff;
        --asm-cyan: #4fe3c1;
        --asm-purple-soft: rgba(181,92,255,.16);
        --asm-cyan-soft: rgba(79,227,193,.10);
        --asm-shadow: 0 20px 80px rgba(0,0,0,.42);
        --asm-shadow-2: 0 0 30px rgba(181,92,255,.16);
        --asm-shadow-3: 0 0 26px rgba(79,227,193,.12);
        --asm-radius: 24px;
        --asm-radius-2: 16px;
        --asm-ease: cubic-bezier(.2,.9,.2,1);
      }

      body.asm-lock { overflow: hidden !important; }

      #account-select-modal, #account-select-modal * { box-sizing: border-box; }
      #account-select-modal { overflow-x: hidden; }
      #account-select-modal .asm-panel,
      #account-select-modal .asm-body,
      #account-select-modal .asm-list { overflow-x: hidden !important; }

      #pixel-select-modal, #pixel-select-modal * { box-sizing: border-box; }
      #pixel-select-modal { overflow-x: hidden; }
      #pixel-select-modal .asm-panel,
      #pixel-select-modal .asm-body,
      #pixel-select-modal .asm-list { overflow-x: hidden !important; }

      #account-select-modal.hidden, #pixel-select-modal.hidden { display:none !important; }
      #account-select-modal, #pixel-select-modal{
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: none;
      }
      #account-select-modal.asm-open, #pixel-select-modal.asm-open{ display:block; }

      .asm-backdrop{
        position:absolute; inset:0;
        background:
          radial-gradient(1100px 480px at 14% -4%, rgba(181,92,255,.18), transparent 58%),
          radial-gradient(820px 340px at 86% 8%, rgba(79,227,193,.10), transparent 56%),
          radial-gradient(760px 300px at 50% 100%, rgba(181,92,255,.09), transparent 60%),
          rgba(4,4,8,.68);
        backdrop-filter: blur(12px) saturate(125%);
        -webkit-backdrop-filter: blur(12px) saturate(125%);
        opacity: 0;
        animation: asmFadeIn .18s var(--asm-ease) forwards;
      }

      .asm-panel{
        position: relative;
        width: min(900px, calc(100vw - 28px));
        max-height: calc(100vh - 28px);
        margin: 14px auto;
        border-radius: var(--asm-radius);
        border: 1px solid var(--asm-border);
        background: var(--asm-panel);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.04),
          var(--asm-shadow),
          var(--asm-shadow-2),
          var(--asm-shadow-3);
        backdrop-filter: blur(16px) saturate(135%);
        -webkit-backdrop-filter: blur(16px) saturate(135%);
        overflow: hidden;
        display:flex;
        flex-direction:column;
        transform: translateY(14px) scale(.985);
        opacity: 0;
        animation: asmPopIn .24s var(--asm-ease) .02s forwards;
      }

      .asm-panel::before{
        content:"";
        position:absolute;
        inset:0;
        pointer-events:none;
        background:
          radial-gradient(460px 180px at 12% 0%, rgba(181,92,255,.12), transparent 62%),
          radial-gradient(340px 150px at 92% 14%, rgba(79,227,193,.08), transparent 58%);
        opacity:.95;
      }

      .asm-panel::after{
        content:"";
        position:absolute;
        inset:0;
        pointer-events:none;
        background: linear-gradient(110deg, transparent, rgba(255,255,255,.035), transparent);
        transform: translateX(-120%);
        opacity:.6;
        animation: asmAmbientSweep 5.2s ease-in-out infinite;
      }

      .asm-head{
        position: relative;
        padding: 15px 16px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        border-bottom: 1px solid var(--asm-border-soft);
        background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,0));
      }

      .asm-title{
        font-weight: 800;
        font-size: 14px;
        letter-spacing: .18px;
        display:flex;
        gap:10px;
        align-items:center;
        color: var(--asm-text);
      }

      .asm-title::before{
        content:"*";
        display:inline-flex;
        width: 26px;
        height: 26px;
        align-items:center;
        justify-content:center;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(181,92,255,.18), rgba(181,92,255,.08));
        border: 1px solid rgba(181,92,255,.26);
        color: rgba(224,196,255,.95);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 0 18px rgba(181,92,255,.22);
      }

      .asm-sub{
        color: var(--asm-muted);
        font-size: 12px;
        margin-top: 4px;
      }

      .asm-x{
        appearance:none;
        border: 1px solid var(--asm-border);
        background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));
        color: rgba(235,232,244,.90);
        cursor:pointer;
        padding: 8px 10px;
        border-radius: 14px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        transition: transform .14s var(--asm-ease), background .14s var(--asm-ease), border-color .14s var(--asm-ease), box-shadow .14s var(--asm-ease);
      }
      .asm-x:hover{
        transform: translateY(-1px);
        background: linear-gradient(180deg, rgba(181,92,255,.10), rgba(255,255,255,.04));
        border-color: rgba(181,92,255,.24);
        box-shadow: 0 0 18px rgba(181,92,255,.14);
      }

      .asm-body{
        padding: 14px 16px 12px;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .asm-body::-webkit-scrollbar{ width: 8px; }
      .asm-body::-webkit-scrollbar-track{
        background: rgba(8,8,12,.92);
        border-radius: 999px;
      }
      .asm-body::-webkit-scrollbar-thumb{
        background: linear-gradient(180deg, rgba(44,37,48,.92) 0%, rgba(181,92,255,.52) 100%);
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.03);
      }
      .asm-body::-webkit-scrollbar-thumb:hover{
        background: linear-gradient(180deg, rgba(88,66,104,.96) 0%, rgba(181,92,255,.88) 100%);
      }

      .asm-section{ margin-top: 14px; }
      .asm-section h4{
        margin: 0 0 10px 0;
        font-size: 12.5px;
        font-weight: 800;
        letter-spacing: .16px;
        color: rgba(235,232,244,.94);
        display:flex;
        align-items:center;
        gap:8px;
      }

      .asm-count{
        margin-left: auto;
        color: rgba(194,189,210,.88);
        font-weight: 700;
        font-size: 12px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--asm-border);
        background: linear-gradient(180deg, rgba(19,18,28,.82), rgba(12,12,18,.72));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
      }

      .asm-list{
        display:flex;
        flex-direction: column;
        gap:10px;
        overflow-x:hidden;
      }

      .asm-chip{
        position: relative;
        display:flex;
        align-items:center;
        gap:12px;
        padding: 12px 12px;
        border-radius: var(--asm-radius-2);
        border: 1px solid var(--asm-border);
        background: var(--asm-surface);
        cursor:pointer;
        user-select:none;
        overflow:hidden;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.025),
          0 10px 28px rgba(0,0,0,.20);
        transition: transform .14s var(--asm-ease), border-color .14s var(--asm-ease), background .14s var(--asm-ease), box-shadow .14s var(--asm-ease);
      }

      .asm-chip:hover{
        transform: translateY(-1px);
        border-color: rgba(181,92,255,.20);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.03),
          0 16px 36px rgba(0,0,0,.24),
          0 0 18px rgba(181,92,255,.12);
        background:
          radial-gradient(320px 120px at 0% 0%, rgba(181,92,255,.08), transparent 60%),
          linear-gradient(180deg, rgba(20,16,30,.84), rgba(11,11,16,.86));
      }

      .asm-chip::after{
        content:"";
        position:absolute;
        inset: 0;
        border-radius: var(--asm-radius-2);
        background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,.06) 48%, transparent 72%);
        transform: translateX(-120%);
        opacity: 0;
        pointer-events:none;
      }
      .asm-chip:hover::after{
        opacity: 1;
        animation: asmShimmer .9s var(--asm-ease) forwards;
      }

      .asm-chip-text{
        display:block;
        min-width:0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: rgba(236,233,244,.94);
        font-weight: 650;
        letter-spacing: .08px;
      }

      .asm-chip input[type="checkbox"]{
        appearance:none;
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(8,8,12,.52);
        display:inline-flex;
        align-items:center;
        justify-content:center;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 0 0 1px rgba(255,255,255,.015);
        transition: border-color .14s var(--asm-ease), background .14s var(--asm-ease), transform .14s var(--asm-ease), box-shadow .14s var(--asm-ease);
      }
      .asm-chip input[type="checkbox"]:hover{ border-color: rgba(181,92,255,.38); }
      .asm-chip input[type="checkbox"]:checked{
        background: linear-gradient(180deg, rgba(181,92,255,.98), rgba(126,73,234,.78));
        border-color: rgba(200,124,255,.55);
        box-shadow:
          0 0 0 1px rgba(181,92,255,.18),
          0 0 18px rgba(181,92,255,.24);
        transform: scale(1.02);
      }
      .asm-chip input[type="checkbox"]:checked::before{
        content:"*";
        font-size: 12px;
        color: white;
        font-weight: 900;
        transform: translateY(-.5px);
      }

      .asm-chip input[disabled]{ opacity:.45; cursor:not-allowed; }
      .asm-chip:has(input[disabled]){
        opacity:.72;
        cursor:not-allowed;
        filter: saturate(.9);
      }

      .asm-err{
        color:#fecaca;
        font-size: 12px;
        margin-bottom: 10px;
        display:none;
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(239,68,68,.22);
        background: linear-gradient(180deg, rgba(127,29,29,.18), rgba(55,15,15,.14));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.02);
      }

      #asm-hint, #pxm-hint{
        padding: 9px 11px;
        border-radius: 14px;
        border: 1px solid var(--asm-border);
        background: var(--asm-surface-2);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
        margin-top: 12px;
      }

      .asm-footer{
        padding: 12px 16px;
        display:flex;
        gap:10px;
        justify-content:flex-end;
        align-items:center;
        border-top: 1px solid var(--asm-border-soft);
        background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
      }

      .asm-footer-left{
        margin-right:auto;
        display:flex;
        align-items:center;
        gap:10px;
        min-width:0;
      }

      .asm-step{
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .16px;
        color: rgba(240,236,248,.92);
        padding: 5px 11px;
        border-radius: 999px;
        border: 1px solid var(--asm-border);
        background: linear-gradient(180deg, rgba(28,26,38,.88), rgba(15,15,22,.78));
        box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        white-space: nowrap;
      }

      .asm-link{
        appearance:none;
        border: none;
        background: transparent;
        color: rgba(200,162,255,.94);
        cursor:pointer;
        font-weight: 750;
        font-size: 12.5px;
        padding: 6px 8px;
        border-radius: 10px;
        transition: background .14s var(--asm-ease), transform .14s var(--asm-ease), color .14s var(--asm-ease);
        white-space: nowrap;
      }
      .asm-link:hover{
        background: rgba(181,92,255,.12);
        color: #e6d5ff;
        transform: translateY(-1px);
      }

      .asm-btn{
        appearance:none;
        border: 1px solid rgba(255,255,255,.10);
        background: linear-gradient(180deg, rgba(34,34,44,.62), rgba(20,20,28,.82));
        color: rgba(238,235,246,.94);
        padding: 10px 14px;
        border-radius: 14px;
        cursor:pointer;
        font-weight: 700;
        font-size: 13px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
        transition: transform .14s var(--asm-ease), background .14s var(--asm-ease), border-color .14s var(--asm-ease), box-shadow .14s var(--asm-ease);
      }
      .asm-btn:hover{
        transform: translateY(-1px);
        background: linear-gradient(180deg, rgba(42,42,56,.72), rgba(22,22,32,.88));
        border-color: rgba(181,92,255,.18);
        box-shadow: 0 0 16px rgba(181,92,255,.08);
      }

      .asm-btn-primary{
        background: linear-gradient(135deg, #b55cff 0%, #c87cff 55%, #8e53ff 100%);
        border-color: rgba(200,124,255,.34);
        color:#fff;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.12),
          0 14px 36px rgba(181,92,255,.24);
      }
      .asm-btn-primary:hover{
        background: linear-gradient(135deg, #ac50ff 0%, #d08cff 55%, #9a60ff 100%);
        border-color: rgba(210,167,255,.46);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.12),
          0 18px 42px rgba(181,92,255,.30);
      }

      .asm-btn-primary--disabled{
        opacity:.55;
        cursor:not-allowed;
        box-shadow:none;
        transform:none !important;
      }

      .asm-spot{
        border: 1px solid var(--asm-border);
        background: var(--asm-surface);
        border-radius: 18px;
        padding: 13px 13px;
        margin-bottom: 12px;
        overflow:hidden;
        position:relative;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.025),
          0 12px 32px rgba(0,0,0,.18);
      }

      .asm-spot::before{
        content:"";
        position:absolute;
        inset:0;
        pointer-events:none;
        background:
          radial-gradient(340px 120px at 0% 0%, rgba(181,92,255,.09), transparent 60%),
          radial-gradient(280px 110px at 100% 0%, rgba(79,227,193,.05), transparent 58%);
      }

      .asm-spot::after{
        content:"";
        position:absolute;
        inset:0;
        background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,.05) 48%, transparent 72%);
        transform: translateX(-120%);
        opacity: 0;
        pointer-events:none;
      }

      .asm-spot:hover::after{
        opacity: 1;
        animation: asmShimmer .95s var(--asm-ease) forwards;
      }

      .asm-spot-title{
        font-weight: 900;
        letter-spacing: .14px;
        color: rgba(240,237,248,.96);
        font-size: 13px;
        margin-bottom: 6px;
        display:flex;
        align-items:center;
        gap:10px;
      }

      .asm-badge{
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .16px;
        padding: 4px 10px;
        border-radius: 999px;
        color: rgba(255,255,255,.96);
        border: 1px solid rgba(200,124,255,.30);
        background: linear-gradient(180deg, rgba(181,92,255,.26), rgba(110,60,190,.24));
        box-shadow: 0 0 16px rgba(181,92,255,.12);
      }

      .asm-spot-sub{
        font-size: 12px;
        color: rgba(185,179,201,.92);
        line-height: 1.4;
      }

      #asm-exit-confirm{
        position:absolute;
        inset:0;
        z-index: 1000;
      }
      .asm-exit-backdrop{
        position:absolute;
        inset:0;
        background:
          radial-gradient(480px 180px at 50% 30%, rgba(181,92,255,.12), transparent 62%),
          rgba(3,4,8,.62);
        backdrop-filter: blur(8px) saturate(120%);
        -webkit-backdrop-filter: blur(8px) saturate(120%);
      }
      .asm-exit-card{
        position:absolute;
        left:50%;
        top:50%;
        transform: translate(-50%,-50%);
        width: min(520px, calc(100vw - 28px));
        border-radius: 22px;
        border: 1px solid var(--asm-border);
        background: var(--asm-panel);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.04),
          var(--asm-shadow),
          var(--asm-shadow-2);
        backdrop-filter: blur(18px) saturate(135%);
        -webkit-backdrop-filter: blur(18px) saturate(135%);
        padding: 16px 16px 14px;
      }
      .asm-exit-title{
        font-weight: 900;
        letter-spacing: .16px;
        color: rgba(240,237,248,.96);
        font-size: 14px;
      }
      .asm-exit-sub{
        margin-top: 8px;
        color: rgba(185,179,201,.92);
        font-size: 12.5px;
        line-height: 1.45;
      }
      .asm-exit-actions{
        margin-top: 14px;
        display:flex;
        gap:10px;
        justify-content:flex-end;
      }
      .asm-exit-foot{
        margin-top: 10px;
        font-size: 11.5px;
        color: rgba(160,170,192,.82);
      }

      .asm-shake{
        animation: asmShake .38s var(--asm-ease);
      }
      @keyframes asmShake{
        0%{ transform: translateY(0) scale(1); }
        20%{ transform: translateY(0) translateX(-6px); }
        40%{ transform: translateY(0) translateX(6px); }
        60%{ transform: translateY(0) translateX(-4px); }
        80%{ transform: translateY(0) translateX(4px); }
        100%{ transform: translateY(0) translateX(0); }
      }

      @keyframes asmFadeIn{ from { opacity: 0; } to { opacity: 1; } }
      @keyframes asmPopIn{
        from { opacity: 0; transform: translateY(16px) scale(.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes asmShimmer{
        from { transform: translateX(-120%); }
        to { transform: translateX(120%); }
      }
      @keyframes asmAmbientSweep{
        0%{ transform: translateX(-120%); opacity: 0; }
        20%{ opacity: .55; }
        65%{ opacity: .55; }
        100%{ transform: translateX(120%); opacity: 0; }
      }

      @media (max-width: 640px){
        .asm-panel{
          width: calc(100vw - 12px);
          margin: 6px auto;
          max-height: calc(100vh - 12px);
          border-radius: 18px;
          backdrop-filter: blur(12px) saturate(125%);
          -webkit-backdrop-filter: blur(12px) saturate(125%);
        }

        .asm-head{
          padding: 12px 12px;
          align-items: flex-start;
          gap: 10px;
        }

        .asm-title{
          font-size: 13px;
          line-height: 1.2;
          padding-right: 10px;
        }

        .asm-sub{
          font-size: 11.5px;
          line-height: 1.38;
        }

        .asm-body{
          padding: 12px 12px 10px;
        }

        .asm-chip{
          padding: 11px 11px;
          align-items: flex-start;
        }

        .asm-chip-text{
          white-space: normal;
          overflow: visible;
          text-overflow: initial;
          line-height: 1.38;
          word-break: break-word;
        }

        .asm-spot{
          padding: 12px;
          border-radius: 16px;
        }

        .asm-spot-title{
          align-items: flex-start;
          gap: 8px;
          flex-wrap: wrap;
        }

        .asm-spot-sub{
          font-size: 11.5px;
          line-height: 1.46;
        }

        #asm-hint, #pxm-hint{
          font-size: 11.5px;
          line-height: 1.42;
        }

        .asm-footer{
          padding: 10px 12px 12px;
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
        }

        .asm-footer-left{
          margin-right: 0;
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .asm-step{
          font-size: 11px;
        }

        .asm-link{
          font-size: 11.5px;
          padding: 4px 2px;
          white-space: normal;
          text-align: left;
        }

        .asm-btn{
          width: 100%;
          min-height: 44px;
          font-size: 13px;
        }

        .asm-x{
          flex: 0 0 auto;
        }

        .asm-exit-card{
          width: min(94vw, 520px);
          padding: 14px 14px 12px;
          border-radius: 18px;
        }

        .asm-exit-actions{
          flex-direction: column;
        }

        .asm-exit-actions .asm-btn{
          width: 100%;
        }
+      }
     `;
    document.head.appendChild(style);
  }

  function _ensureAccountModalSkeleton() {
    if (_el('account-select-modal')) return;
    _ensureStyles();

    const modal = document.createElement('div');
    modal.id = 'account-select-modal';
    modal.className = 'hidden';
    modal.innerHTML = `
      <div class="asm-backdrop" id="asm-backdrop"></div>
      <div class="asm-panel" role="dialog" aria-modal="true">
        <div class="asm-head">
          <div>
            <div class="asm-title" id="asm-title">Select accounts</div>
            <div class="asm-sub" id="asm-sub">Select up to ${MAX_SELECT} account per type.</div>
          </div>
          <button class="asm-x" id="asm-close" aria-label="Close">✕</button>
        </div>

        <div class="asm-body">
          <div id="asm-error" class="asm-err"></div>

          <!-- ✅ Step A: Accounts -->
          <div id="asm-stepA">
            <div id="asm-meta-title" class="asm-section hidden">
              <h4>Meta Ads <span class="asm-count" id="asm-meta-count">0/${MAX_SELECT}</span></h4>
              <div class="asm-list" id="asm-meta-list"></div>
            </div>

            <div id="asm-google-ads-title" class="asm-section hidden">
              <h4>Google Ads <span class="asm-count" id="asm-google-ads-count">0/${MAX_SELECT}</span></h4>
              <div class="asm-list" id="asm-google-ads-list"></div>
            </div>

            <div id="asm-google-ga-title" class="asm-section hidden">
              <h4>Google Analytics (GA4) <span class="asm-count" id="asm-google-ga-count">0/${MAX_SELECT}</span></h4>
              <div class="asm-list" id="asm-google-ga-list"></div>
            </div>
          </div>

          <!-- ✅ Step B: Recommended (Meta Pixel OR Google Conversion) -->
          <div id="asm-stepB" class="hidden">
            <div id="asm-rec-box"></div>
          </div>

          <!-- ✅ Step C: All (Meta Pixel OR Google Conversion) -->
          <div id="asm-stepC" class="hidden">
            <div id="asm-pxm-meta-title" class="asm-section hidden">
              <h4>Meta Pixel <span class="asm-count" id="asm-pxm-meta-count">0/${MAX_SELECT}</span></h4>
              <div class="asm-list" id="asm-pxm-meta-list"></div>
            </div>

            <div id="asm-pxm-google-title" class="asm-section hidden">
              <h4>Google Conversions <span class="asm-count" id="asm-pxm-google-count">0/${MAX_SELECT}</span></h4>
              <div class="asm-list" id="asm-pxm-google-list"></div>
            </div>
          </div>
        </div>

        <div class="asm-footer">
          <div class="asm-footer-left">
            <span class="asm-step hidden" id="asm-step-chip">Step 1/3</span>
            <button class="asm-link hidden" id="asm-back">Back</button>
            <button class="asm-link hidden" id="asm-change">Want to change your pixel?</button>
          </div>
          <button class="asm-btn" id="asm-cancel">Cancel</button>
          <button class="asm-btn asm-btn-primary" id="asm-save">Save selection</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const b = _el('asm-backdrop');
    if (b) {
      b.addEventListener('click', () => {
        _shakeModal('account-select-modal');
        _hint('Finish onboarding to continue.', 'warn', 'account-select-modal');
      });
    }

    const x = _el('asm-close');
    if (x) x.addEventListener('click', () => _openExitConfirm('account-select-modal'));

    const c = _el('asm-cancel');
    if (c) c.addEventListener('click', () => _openExitConfirm('account-select-modal'));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = _el('account-select-modal');
        if (m && m.style.display !== 'none') {
          if (_isExitConfirmOpen('account-select-modal')) return;
          _openExitConfirm('account-select-modal');
        }
      }
    });
  }

  // (Se mantiene por compat; ya no lo necesitamos para E2E)
  function _ensurePixelModalSkeleton() {
    if (_el('pixel-select-modal')) return;
    _ensureStyles();

    const modal = document.createElement('div');
    modal.id = 'pixel-select-modal';
    modal.className = 'hidden';
    modal.innerHTML = `
      <div class="asm-backdrop" id="pxm-backdrop"></div>
      <div class="asm-panel" role="dialog" aria-modal="true">
        <div class="asm-head">
          <div>
            <div class="asm-title" id="pxm-title">Select pixel</div>
            <div class="asm-sub" id="pxm-sub">Select 1 option to continue.</div>
          </div>
          <button class="asm-x" id="pxm-close" aria-label="Close">✕</button>
        </div>

        <div class="asm-body">
          <div id="pxm-error" class="asm-err"></div>

          <div id="pxm-meta-title" class="asm-section hidden">
            <h4>Meta Pixel <span class="asm-count" id="pxm-meta-count">0/${MAX_SELECT}</span></h4>
            <div class="asm-list" id="pxm-meta-list"></div>
          </div>

          <div id="pxm-google-title" class="asm-section hidden">
            <h4>Google Conversions <span class="asm-count" id="pxm-google-count">0/${MAX_SELECT}</span></h4>
            <div class="asm-list" id="pxm-google-list"></div>
          </div>
        </div>

        <div class="asm-footer">
          <button class="asm-btn" id="pxm-cancel">Cancel</button>
          <button class="asm-btn asm-btn-primary" id="pxm-save">Save selection</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const modalId = 'pixel-select-modal';

    const b = _el('pxm-backdrop');
    if (b) {
      b.addEventListener('click', () => {
        _shakeModal(modalId);
        _hint('Finish onboarding to continue.', 'warn', modalId);
      });
    }

    const x = _el('pxm-close');
    if (x) x.addEventListener('click', () => _openExitConfirm(modalId));

    const c = _el('pxm-cancel');
    if (c) c.addEventListener('click', () => _openExitConfirm(modalId));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = _el(modalId);
        if (m && m.style.display !== 'none') {
          if (_isExitConfirmOpen(modalId)) return;
          _openExitConfirm(modalId);
        }
      }
    });
  }

  /* =========================================================
   * Loaders (accounts)
   * =======================================================*/
  async function _loadMeta() {
    let v = null;
    try {
      v = await _json('/auth/meta/accounts');
    } catch {
      try {
        v = await _json('/api/meta/accounts?all=1');
      } catch {
        v = await _json('/api/meta/accounts');
      }
    }

    const raw =
      v?.accounts ||
      v?.ad_accounts ||
      v?.ad_accounts_all ||
      v?.accounts_all ||
      [];
    const list = (raw || [])
      .map((a) => {
        const id = normActId(a.account_id || a.id || '');
        return {
          ...a,
          id,
          name: a.name || a.account_name || (id ? `act_${id}` : null),
        };
      })
      .filter((a) => !!a.id);

    ASM.data.meta = list;

    const selected = Array.isArray(v?.selectedAccountIds)
      ? v.selectedAccountIds
      : Array.isArray(v?.selected)
      ? v.selected
      : [];

    const def = v?.defaultAccountId || null;

    ASM.sel.meta.clear();
    const first = selected?.[0]
      ? normActId(selected[0])
      : def
      ? normActId(def)
      : '';
    if (first) ASM.sel.meta.add(first);

    const count = ASM.data.meta.length;
    const allow = ASM.only === 'all' || ASM.only === 'meta';
    ASM.visible.meta = allow && (ASM.showAll ? count > 0 : count > 1);
  }

  async function _loadGoogle() {
    const st = await _json('/auth/google/status');

    ASM.data.googleAds = Array.isArray(st.ad_accounts)
      ? st.ad_accounts
      : Array.isArray(st.customers)
      ? st.customers
      : [];

    ASM.data.googleGa = Array.isArray(st.gaProperties) ? st.gaProperties : [];

    // Prefill Ads
    ASM.sel.googleAds.clear();
    const selAds = Array.isArray(st.selectedCustomerIds)
      ? st.selectedCustomerIds.map(normGadsId)
      : [];
    const defAds = st.defaultCustomerId ? normGadsId(st.defaultCustomerId) : '';
    if (selAds[0]) ASM.sel.googleAds.add(selAds[0]);
    else if (defAds) ASM.sel.googleAds.add(defAds);

    // Prefill GA4 (✅ SOLO 1 RAW)
    ASM.sel.googleGa.clear();
    const selGA4Raw = Array.isArray(st.selectedPropertyIds)
      ? st.selectedPropertyIds.map((x) => String(x || '').trim())
      : [];
    const defGA4Raw = st.defaultPropertyId
      ? String(st.defaultPropertyId).trim()
      : '';
    const chosenRaw = selGA4Raw[0] || defGA4Raw;
    if (chosenRaw) ASM.sel.googleGa.add(chosenRaw);

    const adsCount = ASM.data.googleAds.length;
    const gaCount = ASM.data.googleGa.length;

    const allowAds = ASM.only === 'all' || ASM.only === 'googleAds';
    const allowGa = ASM.only === 'all' || ASM.only === 'googleGa';

    ASM.visible.googleAds = allowAds && (ASM.showAll ? adsCount > 0 : adsCount > 1);
    ASM.visible.googleGa = allowGa && (ASM.showAll ? gaCount > 0 : gaCount > 1);
  }

  /* =========================================================
   * Loaders (pixels)
   * =======================================================*/
  async function _loadMetaPixels() {
    const v = await _json('/api/meta/pixels');
    const list = Array.isArray(v?.data) ? v.data : [];
    ASM.data.metaPixels = list
      .map((p) => ({
        id: safeStr(p.id),
        name: safeStr(p.name) || safeStr(p.id),
      }))
      .filter((p) => !!p.id);
    ASM.data.metaPixelsRecommendedId = safeStr(v?.recommendedId || '') || null;
    ASM.data.metaPixelsMeta = v?.meta || { adAccountId: '' };

    ASM.sel.metaPixel.clear();
    const rec = ASM.data.metaPixelsRecommendedId;
    if (rec) ASM.sel.metaPixel.add(rec);
    else if (ASM.data.metaPixels.length === 1)
      ASM.sel.metaPixel.add(ASM.data.metaPixels[0].id);

    ASM.visible.metaPixel = true;
  }

  // ranking conversions: enabled + purchase-like + evita audience_
  function _rankConversion(c) {
    const name = safeStr(c?.name).toLowerCase();
    const status = safeStr(c?.status).toUpperCase();
    const type = safeStr(c?.type).toUpperCase();

    let score = 0;
    if (status === 'ENABLED') score += 100;
    if (/(purchase|compra|checkout|order|pedido|conversion|lead|venta)/i.test(name)) score += 50;
    if (/^audience[_\s]/i.test(name)) score -= 50;
    if (type.includes('PURCHASE')) score += 25;
    if (status === 'HIDDEN') score -= 10;
    return score;
  }

  async function _loadGoogleConversions() {
    const v = await _json('/api/google/ads/conversions');
    const list = Array.isArray(v?.data) ? v.data : [];
    ASM.data.googleConversions = list
      .map((c) => ({
        resourceName: safeStr(c.resourceName),
        name: safeStr(c.name) || safeStr(c.resourceName),
        status: safeStr(c.status),
        type: safeStr(c.type),
      }))
      .filter((c) => !!c.resourceName);

    ASM.data.googleConversionsRecommendedResource =
      safeStr(v?.recommendedResource || '') || null;
    ASM.data.googleConversionsMeta = v?.meta || { customerId: '' };

    let rec = ASM.data.googleConversionsRecommendedResource;
    if (!rec && ASM.data.googleConversions.length) {
      const sorted = [...ASM.data.googleConversions].sort(
        (a, b) => _rankConversion(b) - _rankConversion(a)
      );
      rec = sorted[0]?.resourceName || null;
      ASM.data.googleConversionsRecommendedResource = rec;
    }

    ASM.sel.googleConversion.clear();
    if (rec) ASM.sel.googleConversion.add(rec);
    else if (ASM.data.googleConversions.length === 1)
      ASM.sel.googleConversion.add(ASM.data.googleConversions[0].resourceName);

    // en wizard SIEMPRE queremos mostrar (aunque sea 1)
    ASM.visible.googleConversion = true;
  }

  /* =========================================================
   * Render helpers (accounts modal)
   * =======================================================*/
  function _canSaveAccounts() {
    if (ASM.visible.meta && ASM.required.meta && ASM.sel.meta.size === 0) return false;
    if (ASM.visible.googleAds && ASM.required.googleAds && ASM.sel.googleAds.size === 0) return false;
    if (ASM.visible.googleGa && ASM.required.googleGa && ASM.sel.googleGa.size === 0) return false;
    return true;
  }

  function _updateCountAccounts(kind) {
    let spanId;
    if (kind === 'meta') spanId = 'asm-meta-count';
    else if (kind === 'googleAds') spanId = 'asm-google-ads-count';
    else spanId = 'asm-google-ga-count';

    const span = _el(spanId);
    if (span) span.textContent = `${_countFor(kind)}/${MAX_SELECT}`;
  }

  function _updateLimitUIAccounts(kind) {
    const reached = _countFor(kind) >= MAX_SELECT;

    let containerId;
    if (kind === 'meta') containerId = 'asm-meta-list';
    else if (kind === 'googleAds') containerId = 'asm-google-ads-list';
    else containerId = 'asm-google-ga-list';

    const list = _el(containerId);
    if (!list) return;

    list.querySelectorAll('input[type="checkbox"]').forEach((ch) => {
      if (kind === 'googleGa') {
        const anySelected = ASM.sel.googleGa.size > 0;
        if (!anySelected) ch.disabled = false;
        else {
          const fn = ASM._isGoogleGaChecked;
          ch.disabled = typeof fn === 'function' ? !fn(ch.value) : true;
        }
        return;
      }

      if (ASM.sel[kind].has(ch.value)) ch.disabled = false;
      else ch.disabled = reached;
    });

    _updateCountAccounts(kind);

    if (reached)
      _hint(
        `Limit reached: you can only select ${MAX_SELECT} account.`,
        'warn',
        'account-select-modal'
      );
    else _hint(`Select up to ${MAX_SELECT} account per type.`, 'info', 'account-select-modal');

    // Wizard Step A: habilitar por selección del tipo requerido
    if (ASM.flow.next === 'metaPixel' && ASM.flow.step === 'A') {
      _enableSave(ASM.sel.meta.size > 0, 'asm-save');
      return;
    }
    if (ASM.flow.next === 'googleConversion' && ASM.flow.step === 'A') {
      _enableSave(ASM.sel.googleAds.size > 0, 'asm-save');
      return;
    }

    _enableSave(_canSaveAccounts(), 'asm-save');
  }

  function _renderAccountLists() {
    const err = _el('asm-error');
    if (err) {
      err.textContent = '';
      _hideEl(err);
    }

    _hint(`Select up to ${MAX_SELECT} account per type.`, 'info', 'account-select-modal');

    const metaTitle = _el('asm-meta-title');
    const metaList = _el('asm-meta-list');
    const gAdsTitle = _el('asm-google-ads-title');
    const gAdsList = _el('asm-google-ads-list');
    const gGaTitle = _el('asm-google-ga-title');
    const gGaList = _el('asm-google-ga-list');

    // META
    if (ASM.visible.meta && ASM.data.meta.length > 0) {
      _showEl(metaTitle);
      _showEl(metaList);
      metaList.innerHTML = '';

      ASM.data.meta.forEach((a) => {
        const id = normActId(a.id || a.account_id || '');
        const label = a.name || a.account_name || id;
        const isChecked = ASM.sel.meta.has(id);

        const chip = _chip(label, id, 'meta', isChecked, (checked, val, kind, cbEl) => {
          const set = ASM.sel[kind];
          if (checked) {
            if (set.size >= MAX_SELECT) {
              cbEl.checked = false;
              return _hint(`You can only select up to ${MAX_SELECT} account.`, 'warn', 'account-select-modal');
            }
            set.clear();
            set.add(val);
          } else {
            set.delete(val);
          }
          _updateLimitUIAccounts(kind);
        });

        metaList.appendChild(chip);
      });

      _updateLimitUIAccounts('meta');
    } else {
      _hideEl(metaTitle);
      _hideEl(metaList);
    }

    // GOOGLE ADS
    if (ASM.visible.googleAds && ASM.data.googleAds.length > 0) {
      _showEl(gAdsTitle);
      _showEl(gAdsList);
      gAdsList.innerHTML = '';

      ASM.data.googleAds.forEach((a) => {
        const id = normGadsId(a.id || a.customerId || a.customer_id || '');
        const displayName =
          a.name || a.descriptiveName || a.descriptive_name || `Account ${id}`;
        const isChecked = ASM.sel.googleAds.has(id);

        const chip = _chip(displayName, id, 'googleAds', isChecked, (checked, val, kind, cbEl) => {
          const set = ASM.sel[kind];
          if (checked) {
            if (set.size >= MAX_SELECT) {
              cbEl.checked = false;
              return _hint(`You can only select up to ${MAX_SELECT} account.`, 'warn', 'account-select-modal');
            }
            set.clear();
            set.add(val);
          } else {
            set.delete(val);
          }
          _updateLimitUIAccounts(kind);
        });

        gAdsList.appendChild(chip);
      });

      _updateLimitUIAccounts('googleAds');
    } else {
      _hideEl(gAdsTitle);
      _hideEl(gAdsList);
    }

    // GOOGLE ANALYTICS (GA4)
    ASM._isGoogleGaChecked = (val) => {
      const pickedRaw = Array.from(ASM.sel.googleGa)[0] || '';
      if (!pickedRaw) return false;
      return normGA4Id(pickedRaw) === normGA4Id(val);
    };

    if (ASM.visible.googleGa && ASM.data.googleGa.length > 0) {
      _showEl(gGaTitle);
      _showEl(gGaList);
      gGaList.innerHTML = '';

      ASM.data.googleGa.forEach((p) => {
        const raw = String(p.propertyId || p.property_id || p.name || '').trim();
        const id = raw || '';
        const displayName = p.displayName || p.display_name || p.name || id;

        const isChecked = ASM._isGoogleGaChecked(id);

        const chip = _chip(displayName, id, 'googleGa', isChecked, (checked, val, kind, cbEl) => {
          const set = ASM.sel[kind];
          if (checked) {
            if (_countFor(kind) >= MAX_SELECT) {
              cbEl.checked = false;
              return _hint(`You can only select up to ${MAX_SELECT} account.`, 'warn', 'account-select-modal');
            }
            set.clear();
            set.add(val); // ✅ SOLO RAW
          } else {
            set.clear(); // GA4 es 1 selección
          }
          _updateLimitUIAccounts(kind);
        });

        gGaList.appendChild(chip);
      });

      _updateLimitUIAccounts('googleGa');
    } else {
      _hideEl(gGaTitle);
      _hideEl(gGaList);
    }

    if (!ASM.visible.meta && !ASM.visible.googleAds && !ASM.visible.googleGa) {
      _hint('There are not enough accounts to select (or there is only 1 account per type).', 'info', 'account-select-modal');
    }

    if (ASM.flow.next === 'metaPixel' && ASM.flow.step === 'A') {
      _enableSave(ASM.sel.meta.size > 0, 'asm-save');
    } else if (ASM.flow.next === 'googleConversion' && ASM.flow.step === 'A') {
      _enableSave(ASM.sel.googleAds.size > 0, 'asm-save');
    } else {
      _enableSave(_canSaveAccounts(), 'asm-save');
    }
  }

  /* =========================================================
   * ✅ Wizard helpers (Meta Pixel + Google Conversion)
   * =======================================================*/
  function _escapeHtml(str) {
    const s = String(str || '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function _bestMetaPixelLocal() {
    const rec = safeStr(ASM.data.metaPixelsRecommendedId || '');
    if (rec) return rec;

    const ranked = [...(ASM.data.metaPixels || [])].sort((a, b) => {
      const na = safeStr(a?.name).toLowerCase();
      const nb = safeStr(b?.name).toLowerCase();

      const score = (n) => {
        let s = 0;
        if (/(purchase|compra|checkout|order|pedido|venta|lead|conversion)/i.test(n)) s += 60;
        if (/(main|principal|primary)/i.test(n)) s += 12;
        if (/test|prueba|dev/i.test(n)) s -= 25;
        return s;
      };

      return score(nb) - score(na);
    });

    return ranked[0]?.id || null;
  }

  async function _confirmPixelSelectionSafe() {
    try {
      await _post('/api/pixels/confirm', { source: 'asm' });
      return true;
    } catch {
      return false;
    }
  }

  async function _saveMetaPixelSelectionAndClose(modal) {
    const id = Array.from(ASM.sel.metaPixel)[0] || null;
    const picked = ASM.data.metaPixels.find((x) => safeStr(x.id) === safeStr(id));

    if (id) {
      await _post('/api/pixels/select', {
        provider: 'meta',
        selectedId: id,
        selectedName: picked?.name || id,
        meta: {
          adAccountId: safeStr(ASM.data.metaPixelsMeta?.adAccountId || ''),
          source: 'asm',
        },
      });
    }

    await _confirmPixelSelectionSafe();

    _closeModalEl(modal);

    const detail = {
      meta: Array.from(ASM.sel.meta).slice(0, 1),
      metaPixel: Array.from(ASM.sel.metaPixel).slice(0, 1),
      mode: ASM.mode,
      only: ASM.only,
      flow: 'metaPixelWizard',
    };

    window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved', { detail }));
    window.dispatchEvent(new CustomEvent('adray:accounts-selection-saved', { detail }));

    window.dispatchEvent(new CustomEvent('adnova:pixels-selection-saved', { detail }));
    window.dispatchEvent(new CustomEvent('adray:pixels-selection-saved', { detail }));
    window.dispatchEvent(new CustomEvent('adray:onboarding-flow-completed', { detail }));
  }

  function _canSkipMetaPixel() {
  return Array.isArray(ASM.data.metaPixels) && ASM.data.metaPixels.length === 0;
}

function _canSaveMetaPixel() {
  return ASM.sel.metaPixel.size > 0 || _canSkipMetaPixel();
}

  function _renderMetaPixelAllList() {
  const titleWrap = _el('asm-pxm-meta-title');
  const listEl = _el('asm-pxm-meta-list');
  const countEl = _el('asm-pxm-meta-count');
  if (!titleWrap || !listEl) return;

  const gTitle = _el('asm-pxm-google-title');
  const gList = _el('asm-pxm-google-list');
  if (gTitle) _hideEl(gTitle);
  if (gList) _hideEl(gList);

  if (!ASM.data.metaPixels.length) {
    _hideEl(titleWrap);
    _hint("You don't have a pixel yet. We recommend activating one later.", 'warn', 'account-select-modal');
    ASM.sel.metaPixel.clear();
    _enableSave(true, 'asm-save');
    return;
  }

  _showEl(titleWrap);
  listEl.innerHTML = '';

  const recId = _bestMetaPixelLocal();
  const sorted = [...ASM.data.metaPixels].sort((a, b) => {
    const aa = safeStr(a.id) === safeStr(recId) ? 1 : 0;
    const bb = safeStr(b.id) === safeStr(recId) ? 1 : 0;
    return bb - aa;
  });

  sorted.forEach((p) => {
    const id = safeStr(p.id);
    const label = safeStr(p.name) || id;
    const isChecked = ASM.sel.metaPixel.has(id);

    const chip = _chip(label, id, 'metaPixel', isChecked, (checked, val, kind, cbEl) => {
      const set = ASM.sel[kind];
      if (checked) {
        if (set.size >= MAX_SELECT) {
          cbEl.checked = false;
          return _hint('You can only select 1 option.', 'warn', 'account-select-modal');
        }
        set.clear();
        set.add(val);
      } else {
        set.delete(val);
      }

      if (countEl) countEl.textContent = `${set.size ? 1 : 0}/${MAX_SELECT}`;
      _enableSave(_canSaveMetaPixel(), 'asm-save');
    });

    listEl.appendChild(chip);
  });

  if (countEl) countEl.textContent = `${ASM.sel.metaPixel.size ? 1 : 0}/${MAX_SELECT}`;
  _enableSave(_canSaveMetaPixel(), 'asm-save');
}

  function _renderMetaPixelRecommendedBox() {
  const box = _el('asm-rec-box');
  if (!box) return;

  const recId = _bestMetaPixelLocal();
  if (!recId) {
    _hint("You don't have a pixel yet. We recommend activating one later.", 'warn', 'account-select-modal');
    _setAccountWizardStep('C');
    _renderMetaPixelAllList();
    return;
  }

  const picked = (ASM.data.metaPixels || []).find((p) => safeStr(p.id) === safeStr(recId));
  const recName = picked?.name || recId;
  ASM.sel.metaPixel.clear();
  ASM.sel.metaPixel.add(recId);

  box.innerHTML = `
    <div class="asm-spot">
      <div class="asm-spot-title">
        <span class="asm-badge">RECOMMENDED</span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${_escapeHtml(recName)}
        </span>
      </div>
      <div class="asm-spot-sub">
        We'll use this pixel to validate conversions and improve your AI insights.
      </div>
      <div class="asm-spot-sub" style="margin-top:10px;">
        If this isn't the right one, tap <b>"Want to change your pixel?"</b>
      </div>
    </div>
  `;

  _enableSave(true, 'asm-save');
}

  // ✅ Google Conversion wizard helpers
  function _canSkipGoogleConversion() {
  return Array.isArray(ASM.data.googleConversions) && ASM.data.googleConversions.length === 0;
}

function _canSaveGoogleConversion() {
  return ASM.sel.googleConversion.size > 0 || _canSkipGoogleConversion();
}

  function _renderGoogleConversionAllList() {
  const titleWrap = _el('asm-pxm-google-title');
  const listEl = _el('asm-pxm-google-list');
  const countEl = _el('asm-pxm-google-count');
  if (!titleWrap || !listEl) return;

  const mTitle = _el('asm-pxm-meta-title');
  const mList = _el('asm-pxm-meta-list');
  if (mTitle) _hideEl(mTitle);
  if (mList) _hideEl(mList);

  if (!ASM.data.googleConversions.length) {
    _hideEl(titleWrap);
    _hint("You don't have a conversion yet. We recommend activating one later.", 'warn', 'account-select-modal');
    ASM.sel.googleConversion.clear();
    _enableSave(true, 'asm-save');
    return;
  }

  _showEl(titleWrap);
  listEl.innerHTML = '';

  const recRes = safeStr(ASM.data.googleConversionsRecommendedResource || '');

  const sorted = [...ASM.data.googleConversions].sort((a, b) => {
    const aa = safeStr(a.resourceName) === recRes ? 1 : 0;
    const bb = safeStr(b.resourceName) === recRes ? 1 : 0;
    return bb - aa;
  });

  sorted.forEach((c) => {
    const id = safeStr(c.resourceName);
    const label = safeStr(c.name) || id;
    const isChecked = ASM.sel.googleConversion.has(id);

    const chip = _chip(label, id, 'googleConversion', isChecked, (checked, val, kind, cbEl) => {
      const set = ASM.sel[kind];
      if (checked) {
        if (set.size >= MAX_SELECT) {
          cbEl.checked = false;
          return _hint('You can only select 1 option.', 'warn', 'account-select-modal');
        }
        set.clear();
        set.add(val);
      } else {
        set.delete(val);
      }

      if (countEl) countEl.textContent = `${set.size ? 1 : 0}/${MAX_SELECT}`;
      _enableSave(_canSaveGoogleConversion(), 'asm-save');
    });

    listEl.appendChild(chip);
  });

  if (countEl) countEl.textContent = `${ASM.sel.googleConversion.size ? 1 : 0}/${MAX_SELECT}`;
  _enableSave(_canSaveGoogleConversion(), 'asm-save');
}

  function _renderGoogleConversionRecommendedBox() {
  const box = _el('asm-rec-box');
  if (!box) return;

  const rec = safeStr(ASM.data.googleConversionsRecommendedResource || '');
  if (!rec) {
    _hint("You don't have a conversion yet. We recommend activating one later.", 'warn', 'account-select-modal');
    _setAccountWizardStep('C');
    _renderGoogleConversionAllList();
    return;
  }

  const picked = (ASM.data.googleConversions || []).find((x) => safeStr(x.resourceName) === rec);
  const recName = picked?.name || rec;

  ASM.sel.googleConversion.clear();
  ASM.sel.googleConversion.add(rec);

  box.innerHTML = `
    <div class="asm-spot">
      <div class="asm-spot-title">
        <span class="asm-badge">RECOMMENDED</span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${_escapeHtml(recName)}
        </span>
      </div>
      <div class="asm-spot-sub">
        We'll use this conversion to improve your AI insights.
      </div>
      <div class="asm-spot-sub" style="margin-top:10px;">
        If this isn't the right one, tap <b>"Want to change your pixel?"</b>
      </div>
    </div>
  `;

  _enableSave(true, 'asm-save');
}

  async function _saveGoogleConversionSelectionAndClose(modal) {
    const resource = Array.from(ASM.sel.googleConversion)[0] || null;
    const picked = ASM.data.googleConversions.find((x) => safeStr(x.resourceName) === safeStr(resource));

    if (resource) {
      await _post('/api/pixels/select', {
  provider: 'google_ads', // ✅ backend acepta SOLO "meta" | "google_ads"
  selectedId: resource,
  selectedName: picked?.name || resource,
  meta: {
    customerId: safeStr(ASM.data.googleConversionsMeta?.customerId || ''),
    source: 'asm',
  },
});
    }

    await _confirmPixelSelectionSafe();

    _closeModalEl(modal);

    const detail = {
      googleAds: Array.from(ASM.sel.googleAds).slice(0, 1),
      googleConversion: Array.from(ASM.sel.googleConversion).slice(0, 1),
      mode: ASM.mode,
      only: ASM.only,
      flow: 'googleConversionWizard',
    };

    window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved', { detail }));
    window.dispatchEvent(new CustomEvent('adray:accounts-selection-saved', { detail }));

    window.dispatchEvent(new CustomEvent('adnova:pixels-selection-saved', { detail }));
    window.dispatchEvent(new CustomEvent('adray:pixels-selection-saved', { detail }));
    window.dispatchEvent(new CustomEvent('adray:onboarding-flow-completed', { detail }));
  }

  function _setAccountWizardStep(step) {
  ASM.flow.step = step;

  const stepChip = _el('asm-step-chip');
  const backBtn = _el('asm-back');
  const changeBtn = _el('asm-change');

  const stepA = _el('asm-stepA');
  const stepB = _el('asm-stepB');
  const stepC = _el('asm-stepC');

  if (!stepA || !stepB || !stepC) return;

  _hideEl(stepA);
  _hideEl(stepB);
  _hideEl(stepC);

  if (backBtn) _hideEl(backBtn);
  if (changeBtn) _hideEl(changeBtn);

  const title = _el('asm-title');
  const sub = _el('asm-sub');
  const saveBtn = _el('asm-save');

  const isMeta = ASM.flow.next === 'metaPixel';
  const isGoogle = ASM.flow.next === 'googleConversion';

  if (step === 'A') {
    _showEl(stepA);

    if (stepChip) {
      _showEl(stepChip);
      stepChip.textContent = 'Step 1/3';
    }

    if (isMeta) {
      if (title) title.textContent = 'Select account';
      if (sub) sub.textContent = 'Select your Meta Ads account to continue.';
      if (saveBtn) saveBtn.textContent = 'Continue';
      _hint('Select your account to continue.', 'info', 'account-select-modal');
      _enableSave(ASM.sel.meta.size > 0, 'asm-save');
    } else if (isGoogle) {
      if (title) title.textContent = 'Select account';
      if (sub) sub.textContent = 'Select your Google Ads account to continue.';
      if (saveBtn) saveBtn.textContent = 'Continue';
      _hint('Select your account to continue.', 'info', 'account-select-modal');
      _enableSave(ASM.sel.googleAds.size > 0, 'asm-save');
    } else {
      if (title) title.textContent = 'Select accounts';
      if (sub) sub.textContent = `Select up to ${MAX_SELECT} account per type.`;
      if (saveBtn) saveBtn.textContent = 'Save selection';
      _hint(`Select up to ${MAX_SELECT} account per type.`, 'info', 'account-select-modal');
      _enableSave(_canSaveAccounts(), 'asm-save');
    }

    return;
  }

  if (step === 'B') {
    _showEl(stepB);

    if (stepChip) {
      _showEl(stepChip);
      stepChip.textContent = 'Step 2/3';
    }
    if (backBtn) _showEl(backBtn);
    if (changeBtn) _showEl(changeBtn);

    if (isMeta) {
      if (title) title.textContent = 'Recommended pixel';
      if (sub) sub.textContent = 'We picked the best option to get started.';
      if (saveBtn) saveBtn.textContent = 'Save selection';
      _hint('We recommend the best option, but you can change it.', 'info', 'account-select-modal');
      _enableSave(true, 'asm-save');
    } else if (isGoogle) {
      if (title) title.textContent = 'Recommended conversion';
      if (sub) sub.textContent = 'We picked the best option to get started.';
      if (saveBtn) saveBtn.textContent = 'Save selection';
      _hint('We recommend the best option, but you can change it.', 'info', 'account-select-modal');
      _enableSave(true, 'asm-save');
    }

    return;
  }

  _showEl(stepC);

  if (stepChip) {
    _showEl(stepChip);
    stepChip.textContent = 'Step 3/3';
  }
  if (backBtn) _showEl(backBtn);

  if (isMeta) {
    if (title) title.textContent = 'Select pixel';
    if (sub) sub.textContent = 'Select a pixel if you already have one. Otherwise, you can continue.';
    if (saveBtn) saveBtn.textContent = 'Save selection';
    _hint(
      _canSkipMetaPixel()
        ? "You don't have a pixel yet. We recommend activating one later."
        : 'Select 1 pixel to continue.',
      _canSkipMetaPixel() ? 'warn' : 'info',
      'account-select-modal'
    );
    _enableSave(_canSaveMetaPixel(), 'asm-save');
  } else if (isGoogle) {
    if (title) title.textContent = 'Select conversion';
    if (sub) sub.textContent = 'Select a conversion if you already have one. Otherwise, you can continue.';
    if (saveBtn) saveBtn.textContent = 'Save selection';
    _hint(
      _canSkipGoogleConversion()
        ? "You don't have a conversion yet. We recommend activating one later."
        : 'Select 1 conversion to continue.',
      _canSkipGoogleConversion() ? 'warn' : 'info',
      'account-select-modal'
    );
    _enableSave(_canSaveGoogleConversion(), 'asm-save');
  }
}

  /* =========================================================
   * ✅ Open Account Modal
   * - Normal mode (cuentas)
   * - Wizard mode (Meta Pixel / Google Conversion) A->B->C
   * =======================================================*/
  async function _openAccountModal(opts = {}) {
    _ensureAccountModalSkeleton();
    _renderAccountLists();

    const modal = _el('account-select-modal');
    _openModalEl(modal);

    const saveBtn = _el('asm-save');
    const backBtn = _el('asm-back');
    const changeBtn = _el('asm-change');

    // Default back/change handlers will be replaced per-wizard
    if (backBtn) backBtn.onclick = null;
    if (changeBtn) changeBtn.onclick = null;

    if (!saveBtn) return;

    // ✅ Meta Pixel wizard
    if (ASM.flow.next === 'metaPixel') {
      ASM.only = 'meta';
      ASM.required.meta = true;

      _setAccountWizardStep('A');

      if (backBtn) {
        backBtn.onclick = () => {
          if (ASM.flow.step === 'B') return _setAccountWizardStep('A');
          if (ASM.flow.step === 'C') return _setAccountWizardStep('B');
        };
      }
      if (changeBtn) {
        changeBtn.onclick = () => {
          if (ASM.flow.step === 'B') {
            _setAccountWizardStep('C');
            _renderMetaPixelAllList();
          }
        };
      }

      saveBtn.onclick = async () => {
        // Step A: Continue -> save meta account -> load pixels -> Step B
        if (ASM.flow.step === 'A') {
          if (ASM.sel.meta.size === 0) {
            return _hint('Select a Meta Ads account to continue.', 'warn', 'account-select-modal');
          }

          const originalText = saveBtn.textContent;
          saveBtn.textContent = 'Loading...';
          saveBtn.disabled = true;

          try {
            const ids = Array.from(ASM.sel.meta).slice(0, 1);

            try {
              await _post('/auth/meta/accounts/selection', { accountIds: ids });
            } catch {
              await _post('/api/meta/accounts/selection', { accountIds: ids });
            }

            await _loadMetaPixels();

            _setAccountWizardStep('B');
            _renderMetaPixelRecommendedBox();

            saveBtn.textContent = 'Save selection';
            saveBtn.disabled = false;
            return;
          } catch (e) {
            console.error('metaPixel wizard continue error', e);
            const box = _el('asm-error');
            if (box) {
              box.textContent = 'Something went wrong while continuing. Please try again.';
              _showEl(box);
            }
            _hint('', 'info', 'account-select-modal');
            saveBtn.textContent = originalText || 'Continue';
            saveBtn.disabled = false;
            return;
          }
        }

        // Step B/C: Save pixel + confirm + close + events
        if (ASM.flow.step === 'B' || ASM.flow.step === 'C') {
  const originalText = saveBtn.textContent;
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;

  try {
    if (ASM.sel.metaPixel.size === 0 && !_canSkipMetaPixel()) {
      const best = _bestMetaPixelLocal();
      if (best) ASM.sel.metaPixel.add(best);
    }

    if (!_canSaveMetaPixel()) {
      saveBtn.textContent = originalText || 'Save selection';
      saveBtn.disabled = false;
      return _hint('Select 1 pixel to continue.', 'warn', 'account-select-modal');
    }

    await _saveMetaPixelSelectionAndClose(modal);

    saveBtn.textContent = originalText || 'Save selection';
    saveBtn.disabled = false;
  } catch (e) {
    console.error('metaPixel wizard save error', e);
    const box = _el('asm-error');
    if (box) {
      box.textContent = 'Something went wrong while saving your selection. Please try again.';
      _showEl(box);
    }
    _hint('', 'info', 'account-select-modal');
    saveBtn.textContent = originalText || 'Save selection';
    saveBtn.disabled = false;
  }
}
      };

      return;
    }

    // ✅ Google Conversion wizard (E2E FIX)
    if (ASM.flow.next === 'googleConversion') {
      ASM.only = 'googleAds';
      ASM.required.googleAds = true;

      _setAccountWizardStep('A');

      if (backBtn) {
        backBtn.onclick = () => {
          if (ASM.flow.step === 'B') return _setAccountWizardStep('A');
          if (ASM.flow.step === 'C') return _setAccountWizardStep('B');
        };
      }
      if (changeBtn) {
        changeBtn.onclick = () => {
          if (ASM.flow.step === 'B') {
            _setAccountWizardStep('C');
            _renderGoogleConversionAllList();
          }
        };
      }

      saveBtn.onclick = async () => {
        // Step A: Continue -> save customer -> load conversions -> Step B
        if (ASM.flow.step === 'A') {
          if (ASM.sel.googleAds.size === 0) {
            return _hint('Select a Google Ads account to continue.', 'warn', 'account-select-modal');
          }

          const originalText = saveBtn.textContent;
          saveBtn.textContent = 'Loading...';
          saveBtn.disabled = true;

          try {
            const ids = Array.from(ASM.sel.googleAds).slice(0, 1);

            await _post('/auth/google/accounts/selection', { customerIds: ids });

            await _loadGoogleConversions();

            _setAccountWizardStep('B');
            _renderGoogleConversionRecommendedBox();

            saveBtn.textContent = 'Save selection';
            saveBtn.disabled = false;
            return;
          } catch (e) {
            console.error('googleConversion wizard continue error', e);
            const box = _el('asm-error');
            if (box) {
              box.textContent = 'Something went wrong while continuing. Please try again.';
              _showEl(box);
            }
            _hint('', 'info', 'account-select-modal');
            saveBtn.textContent = originalText || 'Continue';
            saveBtn.disabled = false;
            return;
          }
        }

        // Step B/C: Save conversion + confirm + close + events
        if (ASM.flow.step === 'B' || ASM.flow.step === 'C') {
  const originalText = saveBtn.textContent;
  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;

  try {
    if (!_canSaveGoogleConversion()) {
      saveBtn.textContent = originalText || 'Save selection';
      saveBtn.disabled = false;
      return _hint('Select 1 conversion to continue.', 'warn', 'account-select-modal');
    }

    await _saveGoogleConversionSelectionAndClose(modal);

    saveBtn.textContent = originalText || 'Save selection';
    saveBtn.disabled = false;
  } catch (e) {
    console.error('googleConversion wizard save error', e);
    const box = _el('asm-error');
    if (box) {
      box.textContent = 'Something went wrong while saving your selection. Please try again.';
      _showEl(box);
    }
    _hint('', 'info', 'account-select-modal');
    saveBtn.textContent = originalText || 'Save selection';
    saveBtn.disabled = false;
  }
}
      };

      return;
    }

    // ✅ Normal mode (cuentas)
    saveBtn.textContent = 'Save selection';
    saveBtn.onclick = async () => {
      if (!_canSaveAccounts()) return;

      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      try {
        const tasks = [];

        // META
        if (ASM.visible.meta) {
          const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
          if (ids.length) {
            tasks.push(
              (async () => {
                try {
                  await _post('/auth/meta/accounts/selection', { accountIds: ids });
                } catch {
                  await _post('/api/meta/accounts/selection', { accountIds: ids });
                }
              })()
            );
          }
        }

        // GA4 (✅ SOLO RAW properties/xxx)
        if (ASM.visible.googleGa) {
          const chosen = Array.from(ASM.sel.googleGa)[0] || null;
          if (chosen) {
            tasks.push(
              (async () => {
                try {
                  await _post('/auth/google/ga4/selection', { propertyIds: [chosen] });
                } catch {
                  await _post('/api/google/analytics/selection', { propertyIds: [chosen] });
                }
              })()
            );
          }
        }

        // Google Ads (POST canónico)
        if (ASM.visible.googleAds) {
          const ids = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
          if (ids.length) {
            tasks.push(_post('/auth/google/accounts/selection', { customerIds: ids }));
          }
        }

        await Promise.all(tasks);

        _closeModalEl(modal);

        const detail = {
          meta: Array.from(ASM.sel.meta).slice(0, 1),
          googleAds: Array.from(ASM.sel.googleAds).slice(0, 1),
          ga4: Array.from(ASM.sel.googleGa).slice(0, 1),
          mode: ASM.mode,
          only: ASM.only,
        };

        window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved', { detail }));
        window.dispatchEvent(new CustomEvent('adray:accounts-selection-saved', { detail }));
      } catch (e) {
        console.error('save selection error', e);

        const box = _el('asm-error');
        if (box) {
          box.textContent = 'Something went wrong while saving your selection. Please try again.';
          _showEl(box);
        }
        _hint('', 'info', 'account-select-modal');

        saveBtn.textContent = originalText || 'Save selection';
        _enableSave(_canSaveAccounts(), 'asm-save');
      }
    };
  }

  /* =========================================================
   * Pixels modal (legacy open) - kept for compatibility
   * =======================================================*/
  async function _openPixelModalLegacy() {
    // NOT USED in our E2E flow anymore, but kept so nothing breaks if called.
    _ensurePixelModalSkeleton();
    const modal = _el('pixel-select-modal');
    _openModalEl(modal);

    const err = _el('pxm-error');
    if (err) {
      err.textContent = '';
      _hideEl(err);
    }

    const gWrap = _el('pxm-google-title');
    const gList = _el('pxm-google-list');
    const gCount = _el('pxm-google-count');

    if (!gWrap || !gList) return;

    if (!ASM.data.googleConversions.length) {
      _hideEl(gWrap);
      _hint("We couldn't find any conversions.", 'warn', 'pixel-select-modal');
      return;
    }

    _showEl(gWrap);
    gList.innerHTML = '';

    const recRes = safeStr(ASM.data.googleConversionsRecommendedResource || '');
    const sorted = [...ASM.data.googleConversions].sort((a, b) => {
      const aa = safeStr(a.resourceName) === recRes ? 1 : 0;
      const bb = safeStr(b.resourceName) === recRes ? 1 : 0;
      return bb - aa;
    });

    sorted.forEach((c) => {
      const id = safeStr(c.resourceName);
      const label = safeStr(c.name) || id;
      const isChecked = ASM.sel.googleConversion.has(id);

      const chip = _chip(label, id, 'googleConversion', isChecked, (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            return _hint('You can only select 1 option.', 'warn', 'pixel-select-modal');
          }
          set.clear();
          set.add(val);
        } else {
          set.delete(val);
        }
        if (gCount) gCount.textContent = `${set.size ? 1 : 0}/${MAX_SELECT}`;
      });

      gList.appendChild(chip);
    });

    if (gCount) gCount.textContent = `${ASM.sel.googleConversion.size ? 1 : 0}/${MAX_SELECT}`;

    const saveBtn = _el('pxm-save');
    const cancelBtn = _el('pxm-cancel');
    const closeBtn = _el('pxm-close');

    if (closeBtn) closeBtn.onclick = () => _openExitConfirm('pixel-select-modal');
    if (cancelBtn) cancelBtn.onclick = () => _openExitConfirm('pixel-select-modal');

    if (saveBtn) {
      saveBtn.onclick = async () => {
        try {
          if (!_canSaveGoogleConversion()) {
            return _hint('Select 1 conversion to continue.', 'warn', 'pixel-select-modal');
          }
          await _saveGoogleConversionSelectionAndClose(modal);
        } catch (e) {
          console.error('legacy pixel modal save error', e);
          if (err) {
            err.textContent = 'Something went wrong while saving your selection.';
            _showEl(err);
          }
        }
      };
    }
  }

  /* =========================================================
   * Public API: openAccountSelectModal / openPixelSelectModal
   * =======================================================*/
  async function openAccountSelectModal(opts = {}) {
    const only = opts.only || 'all';
    const showAll = !!opts.showAll;
    const required = opts.required || {};
    const next = opts.next || null; // null | 'metaPixel' | 'googleConversion'

    ASM.mode = opts.mode || 'settings';
    ASM.only = only;
    ASM.showAll = showAll;

    ASM.required.meta = !!required.meta;
    ASM.required.googleAds = !!required.googleAds;
    ASM.required.googleGa = !!required.googleGa;

    ASM.sel.meta.clear();
    ASM.sel.googleAds.clear();
    ASM.sel.googleGa.clear();

    ASM.visible.meta = false;
    ASM.visible.googleAds = false;
    ASM.visible.googleGa = false;

    ASM.flow.next = next;
    ASM.flow.step = 'A';

    const tasks = [];
    if (only === 'all' || only === 'meta') tasks.push(_loadMeta().catch(console.error));
    if (only === 'all' || only === 'googleAds' || only === 'googleGa')
      tasks.push(_loadGoogle().catch(console.error));

    await Promise.allSettled(tasks);

    const mustOpen =
      ASM.visible.meta ||
      ASM.visible.googleAds ||
      ASM.visible.googleGa ||
      ASM.flow.next === 'metaPixel' ||
      ASM.flow.next === 'googleConversion';

    if (!mustOpen) {
      window.dispatchEvent(
        new CustomEvent('adnova:accounts-selection-not-needed', {
          detail: { only, showAll, required: ASM.required },
        })
      );
      window.dispatchEvent(
        new CustomEvent('adray:accounts-selection-not-needed', {
          detail: { only, showAll, required: ASM.required },
        })
      );
      return;
    }

    // ✅ If next=metaPixel, force Meta block visible (even if count==1)
    if (ASM.flow.next === 'metaPixel') {
      ASM.only = 'meta';
      ASM.required.meta = true;
      ASM.visible.meta = true;
    }

    // ✅ If next=googleConversion, force Google Ads block visible (even if count==1)
    if (ASM.flow.next === 'googleConversion') {
      ASM.only = 'googleAds';
      ASM.required.googleAds = true;
      ASM.visible.googleAds = true;
    }

    await _openAccountModal(opts);
  }

  async function openPixelSelectModal(opts = {}) {
    const only = opts.only || 'googleConversion'; // metaPixel|googleConversion
    const showAll = !!opts.showAll;
    const required = opts.required || {};

    ASM.mode = opts.mode || 'settings';
    ASM.only = only;
    ASM.showAll = showAll;

    ASM.required.metaPixel = !!required.metaPixel;
    ASM.required.googleConversion = !!required.googleConversion;

    ASM.sel.metaPixel.clear();
    ASM.sel.googleConversion.clear();

    ASM.visible.metaPixel = false;
    ASM.visible.googleConversion = false;

    // ✅ MetaPixel flow ahora va por Account Modal Wizard
    if (only === 'metaPixel') {
      await openAccountSelectModal({
        only: 'meta',
        showAll: true,
        required: { meta: true },
        next: 'metaPixel',
        mode: ASM.mode,
      });
      return;
    }

    // ✅ GoogleConversion flow ahora también va por Account Modal Wizard (E2E)
    if (only === 'googleConversion') {
      await openAccountSelectModal({
        only: 'googleAds',
        showAll: true,
        required: { googleAds: true },
        next: 'googleConversion',
        mode: ASM.mode,
      });
      return;
    }

    // fallback legacy (no debería usarse)
    const tasks = [];
    tasks.push(_loadGoogleConversions().catch(console.error));
    await Promise.allSettled(tasks);
    await _openPixelModalLegacy();
  }

  window.ADNOVA_ASM = window.ADNOVA_ASM || {};
  window.ADNOVA_ASM.openAccountSelectModal = openAccountSelectModal;
  window.ADNOVA_ASM.openPixelSelectModal = openPixelSelectModal;

  window.addEventListener('adnova:open-account-select', (ev) => {
    const d = ev?.detail || {};
    openAccountSelectModal({
      only: d.only || 'all',
      showAll: !!d.showAll,
      required: d.required || {},
      next: d.next || null,
      mode: d.mode || 'settings',
    }).catch(console.error);
  });

  window.addEventListener('adray:open-account-select', (ev) => {
    const d = ev?.detail || {};
    openAccountSelectModal({
      only: d.only || 'all',
      showAll: !!d.showAll,
      required: d.required || {},
      next: d.next || null,
      mode: d.mode || 'settings',
    }).catch(console.error);
  });

  window.addEventListener('adnova:open-pixel-select', (ev) => {
    const d = ev?.detail || {};
    openPixelSelectModal({
      only: d.only || 'googleConversion',
      showAll: !!d.showAll,
      required: d.required || {},
      mode: d.mode || 'settings',
    }).catch(console.error);
  });

  window.addEventListener('adray:open-pixel-select', (ev) => {
    const d = ev?.detail || {};
    openPixelSelectModal({
      only: d.only || 'googleConversion',
      showAll: !!d.showAll,
      required: d.required || {},
      mode: d.mode || 'settings',
    }).catch(console.error);
  });

  function _getQS() {
    try {
      return new URLSearchParams(window.location.search || '');
    } catch {
      return new URLSearchParams();
    }
  }

  function _inferAutoOpenFromQS() {
    const qs = _getQS();

    const selector = qs.get('selector') === '1';

    const metaOk = qs.get('meta') === 'ok';
    const googleOk = qs.get('google') === 'ok';
    const ga4Ok = qs.get('ga4') === 'ok';
    const gadsOk = qs.get('gads') === 'ok';
    const adsOk = qs.get('ads') === 'ok';

    const any = selector || metaOk || googleOk || ga4Ok || gadsOk || adsOk;
    if (!any) return null;

    const product = (qs.get('product') || '').toLowerCase(); // ads|ga4
    let only = 'all';

    if (metaOk) only = 'meta';
    else if (googleOk || ga4Ok || gadsOk || adsOk) {
      if (product === 'ads' || gadsOk || adsOk) only = 'googleAds';
      else if (product === 'ga4' || ga4Ok) only = 'googleGa';
      else only = 'all';
    }

    const required = {
      meta: only === 'meta',
      googleAds: only === 'googleAds',
      googleGa: only === 'googleGa',
    };

    const next =
      metaOk
        ? 'metaPixel'
        : (googleOk && (product === 'ads' || gadsOk || adsOk))
        ? 'googleConversion'
        : null;

    return { only, required, next };
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      const info = _inferAutoOpenFromQS();
      if (!info) return;

      if (info.next === 'metaPixel') {
        openAccountSelectModal({
          only: 'meta',
          showAll: true,
          required: { meta: true },
          next: 'metaPixel',
          mode: 'settings',
        }).catch(console.error);
        return;
      }

      if (info.next === 'googleConversion') {
        openAccountSelectModal({
          only: 'googleAds',
          showAll: true,
          required: { googleAds: true },
          next: 'googleConversion',
          mode: 'settings',
        }).catch(console.error);
        return;
      }

      openAccountSelectModal({
        only: info.only,
        showAll: false,
        required: info.required,
        next: null,
        mode: 'settings',
      }).catch(console.error);
    } catch (e) {
      console.error('ASM auto-open error', e);
    }
  });
})();
