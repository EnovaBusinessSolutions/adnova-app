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
   * State (accounts + pixels)
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

      // pixels
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
  };

  /* =========================================================
   * UI utils (FIX: no romper modal, no mezclar show/hide)
   * =======================================================*/
  const _el = (id) => document.getElementById(id);

  // ✅ show/hide genérico (NO toca body lock)
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

  // ✅ open/close SOLO modal (aquí sí bloqueamos body)
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
   * ✅ Inyectar modal + estilos si NO existe
   * =======================================================*/
  function _ensureStyles() {
    if (document.getElementById('asm-styles')) return;

    const style = document.createElement('style');
    style.id = 'asm-styles';
    style.textContent = `
      :root{
        --asm-bg: rgba(0,0,0,.62);
        --asm-panel: rgba(12,12,18,.80);
        --asm-border: rgba(255,255,255,.10);
        --asm-text: rgba(231,231,241,.92);
        --asm-muted: rgba(161,161,170,.92);

        --asm-purple: #7c3aed;
        --asm-purple-2: #a78bfa;

        --asm-shadow: 0 24px 80px rgba(0,0,0,.55);
        --asm-shadow-2: 0 28px 120px rgba(124,58,237,.14);

        --asm-radius: 18px;
        --asm-radius-2: 14px;

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
          radial-gradient(1200px 700px at 20% 10%, rgba(124,58,237,.16), transparent 60%),
          radial-gradient(900px 600px at 80% 30%, rgba(34,211,238,.08), transparent 55%),
          rgba(0,0,0,.62);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
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
        background: linear-gradient(180deg, rgba(12,12,18,.88), rgba(10,10,14,.74));
        box-shadow: var(--asm-shadow), var(--asm-shadow-2);
        overflow: hidden;
        display:flex;
        flex-direction:column;

        transform: translateY(14px) scale(.985);
        opacity: 0;
        animation: asmPopIn .24s var(--asm-ease) .02s forwards;
      }

      .asm-panel::after{
        content:"";
        position:absolute; left:-40%; top:-60%;
        width: 180%; height: 120%;
        background: radial-gradient(circle at 30% 30%, rgba(167,139,250,.12), transparent 55%);
        opacity:.75;
        pointer-events:none;
      }

      .asm-head{
        position: relative;
        padding: 14px 16px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        border-bottom: 1px solid rgba(255,255,255,.08);
        background: linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.00));
      }

      .asm-title{
        font-weight: 800;
        font-size: 14px;
        letter-spacing: .22px;
        display:flex;
        gap:10px;
        align-items:center;
        color: var(--asm-text);
      }

      .asm-title::before{
        content:"✦";
        display:inline-flex;
        width: 26px;
        height: 26px;
        align-items:center;
        justify-content:center;
        border-radius: 999px;
        background: rgba(124,58,237,.14);
        border: 1px solid rgba(124,58,237,.28);
        color: rgba(167,139,250,.95);
        box-shadow: 0 10px 30px rgba(124,58,237,.18);
      }

      .asm-sub{
        color: var(--asm-muted);
        font-size: 12px;
        margin-top: 4px;
      }

      .asm-x{
        appearance:none;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.04);
        color: rgba(226,232,240,.88);
        cursor:pointer;
        padding: 8px 10px;
        border-radius: 12px;
        transition: transform .14s var(--asm-ease), background .14s var(--asm-ease), border-color .14s var(--asm-ease);
      }
      .asm-x:hover{
        transform: translateY(-1px);
        background: rgba(255,255,255,.08);
        border-color: rgba(167,139,250,.35);
      }

      .asm-body{
        padding: 14px 16px 12px;
        overflow-y: auto;
        overflow-x: hidden;
      }

      .asm-body::-webkit-scrollbar{ width: 10px; }
      .asm-body::-webkit-scrollbar-track{ background: rgba(255,255,255,.03); border-radius: 999px; }
      .asm-body::-webkit-scrollbar-thumb{
        background: rgba(167,139,250,.22);
        border-radius: 999px;
        border: 2px solid rgba(0,0,0,.25);
      }
      .asm-body::-webkit-scrollbar-thumb:hover{ background: rgba(167,139,250,.30); }

      .asm-section{ margin-top: 14px; }
      .asm-section h4{
        margin: 0 0 10px 0;
        font-size: 12.5px;
        font-weight: 800;
        letter-spacing: .18px;
        color: rgba(226,232,240,.92);
        display:flex;
        align-items:center;
        gap:8px;
      }

      .asm-count{
        margin-left: auto;
        color: rgba(148,163,184,.92);
        font-weight: 700;
        font-size: 12px;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.03);
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
        border: 1px solid rgba(255,255,255,.10);
        background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));
        cursor:pointer;
        user-select:none;
        overflow:hidden;
        transition: transform .14s var(--asm-ease), border-color .14s var(--asm-ease), background .14s var(--asm-ease), box-shadow .14s var(--asm-ease);
      }

      .asm-chip:hover{
        transform: translateY(-1px);
        border-color: rgba(167,139,250,.22);
        box-shadow: 0 14px 40px rgba(0,0,0,.30);
        background: linear-gradient(180deg, rgba(124,58,237,.10), rgba(255,255,255,.03));
      }

      .asm-chip::after{
        content:"";
        position:absolute;
        inset: 0;
        border-radius: var(--asm-radius-2);
        background: linear-gradient(120deg, transparent 0%, rgba(167,139,250,.10) 45%, transparent 70%);
        transform: translateX(-120%);
        opacity: 0;
        pointer-events:none;
      }
      .asm-chip:hover::after{
        opacity: 1;
        animation: asmShimmer .85s var(--asm-ease) forwards;
      }

      .asm-chip-text{
        display:block;
        min-width:0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: rgba(226,232,240,.92);
        font-weight: 650;
        letter-spacing: .1px;
      }

      .asm-chip input[type="checkbox"]{
        appearance:none;
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,.20);
        background: rgba(0,0,0,.22);
        display:inline-flex;
        align-items:center;
        justify-content:center;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
        transition: border-color .14s var(--asm-ease), background .14s var(--asm-ease), transform .14s var(--asm-ease);
      }
      .asm-chip input[type="checkbox"]:hover{ border-color: rgba(167,139,250,.40); }
      .asm-chip input[type="checkbox"]:checked{
        background: linear-gradient(180deg, rgba(124,58,237,.95), rgba(124,58,237,.70));
        border-color: rgba(167,139,250,.55);
        transform: scale(1.02);
      }
      .asm-chip input[type="checkbox"]:checked::before{
        content:"✓";
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
        border-radius: 12px;
        border: 1px solid rgba(239,68,68,.25);
        background: rgba(239,68,68,.10);
      }

      #asm-hint, #pxm-hint{
        padding: 8px 10px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.03);
        margin-top: 12px;
      }

      .asm-footer{
        padding: 12px 16px;
        display:flex;
        gap:10px;
        justify-content:flex-end;
        align-items:center;
        border-top: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.02);
      }

      .asm-btn{
        appearance:none;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.05);
        color: rgba(226,232,240,.92);
        padding: 10px 12px;
        border-radius: 12px;
        cursor:pointer;
        font-weight: 700;
        font-size: 13px;
        transition: transform .14s var(--asm-ease), background .14s var(--asm-ease), border-color .14s var(--asm-ease);
      }
      .asm-btn:hover{
        transform: translateY(-1px);
        background: rgba(255,255,255,.08);
        border-color: rgba(167,139,250,.22);
      }

      .asm-btn-primary{
        background: linear-gradient(180deg, rgba(124,58,237,1), rgba(124,58,237,.72));
        border-color: rgba(167,139,250,.35);
        color:#fff;
        box-shadow: 0 16px 50px rgba(124,58,237,.25);
      }
      .asm-btn-primary:hover{
        background: linear-gradient(180deg, rgba(109,40,217,1), rgba(124,58,237,.70));
        border-color: rgba(167,139,250,.55);
      }

      .asm-btn-primary--disabled{
        opacity:.55;
        cursor:not-allowed;
        box-shadow:none;
        transform:none !important;
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

      @media (max-width: 640px){
        .asm-panel{
          width: calc(100vw - 18px);
          margin: 9px auto;
          max-height: calc(100vh - 18px);
          border-radius: 16px;
        }
        .asm-chip{ padding: 11px 11px; }
        .asm-footer{ gap:8px; }
      }
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
            <div class="asm-title">Seleccionar cuentas</div>
            <div class="asm-sub">Selecciona hasta ${MAX_SELECT} cuenta por tipo.</div>
          </div>
          <button class="asm-x" id="asm-close" aria-label="Cerrar">✕</button>
        </div>

        <div class="asm-body">
          <div id="asm-error" class="asm-err"></div>

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

        <div class="asm-footer">
          <button class="asm-btn" id="asm-cancel">Cancelar</button>
          <button class="asm-btn asm-btn-primary" id="asm-save">Guardar selección</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => _closeModalEl(modal);
    const b = _el('asm-backdrop');
    const x = _el('asm-close');
    const c = _el('asm-cancel');

    if (b) b.addEventListener('click', close);
    if (x) x.addEventListener('click', close);
    if (c) c.addEventListener('click', close);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = _el('account-select-modal');
        if (m && m.style.display !== 'none') _closeModalEl(m);
      }
    });
  }

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
            <div class="asm-title" id="pxm-title">Seleccionar pixel</div>
            <div class="asm-sub" id="pxm-sub">Selecciona 1 opción para continuar.</div>
          </div>
          <button class="asm-x" id="pxm-close" aria-label="Cerrar">✕</button>
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
          <button class="asm-btn" id="pxm-cancel">Cancelar</button>
          <button class="asm-btn asm-btn-primary" id="pxm-save">Guardar selección</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => _closeModalEl(modal);
    const b = _el('pxm-backdrop');
    const x = _el('pxm-close');
    const c = _el('pxm-cancel');

    if (b) b.addEventListener('click', close);
    if (x) x.addEventListener('click', close);
    if (c) c.addEventListener('click', close);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = _el('pixel-select-modal');
        if (m && m.style.display !== 'none') _closeModalEl(m);
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

    const raw = v?.accounts || v?.ad_accounts || v?.ad_accounts_all || v?.accounts_all || [];
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
    const first = selected?.[0] ? normActId(selected[0]) : def ? normActId(def) : '';
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
    const selAds = Array.isArray(st.selectedCustomerIds) ? st.selectedCustomerIds.map(normGadsId) : [];
    const defAds = st.defaultCustomerId ? normGadsId(st.defaultCustomerId) : '';
    if (selAds[0]) ASM.sel.googleAds.add(selAds[0]);
    else if (defAds) ASM.sel.googleAds.add(defAds);

    // Prefill GA4 (✅ SOLO 1 RAW)
    ASM.sel.googleGa.clear();
    const selGA4Raw = Array.isArray(st.selectedPropertyIds)
      ? st.selectedPropertyIds.map((x) => String(x || '').trim())
      : [];
    const defGA4Raw = st.defaultPropertyId ? String(st.defaultPropertyId).trim() : '';
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
    ASM.data.metaPixels = list.map((p) => ({ id: safeStr(p.id), name: safeStr(p.name) || safeStr(p.id) })).filter((p) => !!p.id);
    ASM.data.metaPixelsRecommendedId = safeStr(v?.recommendedId || '') || null;
    ASM.data.metaPixelsMeta = v?.meta || { adAccountId: '' };

    ASM.sel.metaPixel.clear();
    const rec = ASM.data.metaPixelsRecommendedId;
    if (rec) ASM.sel.metaPixel.add(rec);
    else if (ASM.data.metaPixels.length === 1) ASM.sel.metaPixel.add(ASM.data.metaPixels[0].id);

    const allow = ASM.only === 'metaPixel';
    const count = ASM.data.metaPixels.length;
    ASM.visible.metaPixel = allow && (ASM.showAll ? count > 0 : count > 1);
  }

  // ranking conversions: enabled + purchase-like + evita audience_
  function _rankConversion(c) {
    const name = safeStr(c?.name).toLowerCase();
    const status = safeStr(c?.status).toUpperCase();
    const type = safeStr(c?.type).toUpperCase();

    let score = 0;
    if (status === 'ENABLED') score += 100;
    if (/(purchase|compra|checkout|order|pedido|conversion)/i.test(name)) score += 50;
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

    ASM.data.googleConversionsRecommendedResource = safeStr(v?.recommendedResource || '') || null;
    ASM.data.googleConversionsMeta = v?.meta || { customerId: '' };

    // si backend no manda recommended, calculamos uno local (por si acaso)
    let rec = ASM.data.googleConversionsRecommendedResource;
    if (!rec && ASM.data.googleConversions.length) {
      const sorted = [...ASM.data.googleConversions].sort((a, b) => _rankConversion(b) - _rankConversion(a));
      rec = sorted[0]?.resourceName || null;
      ASM.data.googleConversionsRecommendedResource = rec;
    }

    ASM.sel.googleConversion.clear();
    if (rec) ASM.sel.googleConversion.add(rec);
    else if (ASM.data.googleConversions.length === 1) ASM.sel.googleConversion.add(ASM.data.googleConversions[0].resourceName);

    const allow = ASM.only === 'googleConversion';
    const count = ASM.data.googleConversions.length;
    ASM.visible.googleConversion = allow && (ASM.showAll ? count > 0 : count > 1);
  }

  /* =========================================================
   * Render helpers (accounts)
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

    if (reached) _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn', 'account-select-modal');
    else _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info', 'account-select-modal');

    _enableSave(_canSaveAccounts(), 'asm-save');
  }

  function _renderAccountLists() {
    const err = _el('asm-error');
    if (err) {
      err.textContent = '';
      _hideEl(err);
    }

    _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info', 'account-select-modal');

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
              return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn', 'account-select-modal');
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
        const displayName = a.name || a.descriptiveName || a.descriptive_name || `Cuenta ${id}`;
        const isChecked = ASM.sel.googleAds.has(id);

        const chip = _chip(displayName, id, 'googleAds', isChecked, (checked, val, kind, cbEl) => {
          const set = ASM.sel[kind];
          if (checked) {
            if (set.size >= MAX_SELECT) {
              cbEl.checked = false;
              return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn', 'account-select-modal');
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
              return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn', 'account-select-modal');
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
      _hint('No hay cuentas suficientes para seleccionar (o solo existe 1 cuenta por tipo).', 'info', 'account-select-modal');
    }

    _enableSave(_canSaveAccounts(), 'asm-save');
  }

  async function _openAccountModal() {
    _ensureAccountModalSkeleton();
    _renderAccountLists();

    const modal = _el('account-select-modal');
    _openModalEl(modal);

    const saveBtn = _el('asm-save');
    if (!saveBtn) return;

    saveBtn.onclick = async () => {
      if (!_canSaveAccounts()) return;

      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Guardando…';
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
          mode: 'settings',
          only: ASM.only,
        };

        window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved', { detail }));
        window.dispatchEvent(new CustomEvent('adray:accounts-selection-saved', { detail }));
      } catch (e) {
        console.error('save selection error', e);

        const box = _el('asm-error');
        if (box) {
          box.textContent = 'Ocurrió un error guardando tu selección. Intenta de nuevo.';
          _showEl(box);
        }
        _hint('', 'info', 'account-select-modal');

        saveBtn.textContent = originalText || 'Guardar selección';
        _enableSave(_canSaveAccounts(), 'asm-save');
      }
    };
  }

  /* =========================================================
   * Pixels modal render/save
   * =======================================================*/
  function _canSavePixels() {
    if (ASM.visible.metaPixel && ASM.required.metaPixel && ASM.sel.metaPixel.size === 0) return false;
    if (ASM.visible.googleConversion && ASM.required.googleConversion && ASM.sel.googleConversion.size === 0) return false;
    return true;
  }

  function _updateCountPixels(kind) {
    const spanId = kind === 'metaPixel' ? 'pxm-meta-count' : 'pxm-google-count';
    const span = _el(spanId);
    if (span) span.textContent = `${_countFor(kind)}/${MAX_SELECT}`;
  }

  function _updateLimitUIPixels(kind) {
    const reached = _countFor(kind) >= MAX_SELECT;

    const containerId = kind === 'metaPixel' ? 'pxm-meta-list' : 'pxm-google-list';
    const list = _el(containerId);
    if (!list) return;

    list.querySelectorAll('input[type="checkbox"]').forEach((ch) => {
      if (ASM.sel[kind].has(ch.value)) ch.disabled = false;
      else ch.disabled = reached;
    });

    _updateCountPixels(kind);

    if (reached) _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT}.`, 'warn', 'pixel-select-modal');
    else _hint(`Selecciona 1 opción para continuar.`, 'info', 'pixel-select-modal');

    _enableSave(_canSavePixels(), 'pxm-save');
  }

  function _renderPixelLists() {
    const err = _el('pxm-error');
    if (err) {
      err.textContent = '';
      _hideEl(err);
    }

    const metaTitle = _el('pxm-meta-title');
    const metaList = _el('pxm-meta-list');
    const gTitle = _el('pxm-google-title');
    const gList = _el('pxm-google-list');

    // Titles (según only)
    const title = _el('pxm-title');
    const sub = _el('pxm-sub');
    if (title) {
      title.textContent = ASM.only === 'googleConversion' ? 'Seleccionar conversion' : 'Seleccionar pixel';
    }
    if (sub) {
      sub.textContent = 'Selecciona 1 opción para continuar.';
    }

    // META PIXELS
    if (ASM.visible.metaPixel && ASM.data.metaPixels.length > 0) {
      _showEl(metaTitle);
      _showEl(metaList);
      metaList.innerHTML = '';

      ASM.data.metaPixels.forEach((p) => {
        const id = safeStr(p.id);
        const label = safeStr(p.name) || id;
        const isChecked = ASM.sel.metaPixel.has(id);

        const chip = _chip(label, id, 'metaPixel', isChecked, (checked, val, kind, cbEl) => {
          const set = ASM.sel[kind];
          if (checked) {
            if (set.size >= MAX_SELECT) {
              cbEl.checked = false;
              return _hint(`Solo puedes seleccionar 1 opción.`, 'warn', 'pixel-select-modal');
            }
            set.clear();
            set.add(val);
          } else {
            set.delete(val);
          }
          _updateLimitUIPixels(kind);
        });

        metaList.appendChild(chip);
      });

      _updateLimitUIPixels('metaPixel');
    } else {
      _hideEl(metaTitle);
      _hideEl(metaList);
    }

    // GOOGLE CONVERSIONS
    if (ASM.visible.googleConversion && ASM.data.googleConversions.length > 0) {
      _showEl(gTitle);
      _showEl(gList);
      gList.innerHTML = '';

      // Ordenamos para UX (primero mejores)
      const sorted = [...ASM.data.googleConversions].sort((a, b) => _rankConversion(b) - _rankConversion(a));

      sorted.forEach((c) => {
        const id = safeStr(c.resourceName);
        const label = safeStr(c.name) || id;
        const isChecked = ASM.sel.googleConversion.has(id);

        const chip = _chip(label, id, 'googleConversion', isChecked, (checked, val, kind, cbEl) => {
          const set = ASM.sel[kind];
          if (checked) {
            if (set.size >= MAX_SELECT) {
              cbEl.checked = false;
              return _hint(`Solo puedes seleccionar 1 opción.`, 'warn', 'pixel-select-modal');
            }
            set.clear();
            set.add(val);
          } else {
            set.delete(val);
          }
          _updateLimitUIPixels(kind);
        });

        gList.appendChild(chip);
      });

      _updateLimitUIPixels('googleConversion');
    } else {
      _hideEl(gTitle);
      _hideEl(gList);
    }

    if (!ASM.visible.metaPixel && !ASM.visible.googleConversion) {
      _hint('No hay opciones suficientes para seleccionar (o solo existe 1).', 'info', 'pixel-select-modal');
    }

    _enableSave(_canSavePixels(), 'pxm-save');
  }

  async function _openPixelModal() {
    _ensurePixelModalSkeleton();
    _renderPixelLists();

    const modal = _el('pixel-select-modal');
    _openModalEl(modal);

    const saveBtn = _el('pxm-save');
    if (!saveBtn) return;

    saveBtn.onclick = async () => {
      if (!_canSavePixels()) return;

      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Guardando…';
      saveBtn.disabled = true;

      try {
        // Guardado centralizado
        if (ASM.visible.metaPixel) {
          const id = Array.from(ASM.sel.metaPixel)[0] || null;
          const picked = ASM.data.metaPixels.find((x) => safeStr(x.id) === safeStr(id));
          if (id) {
            await _post('/api/pixels/select', {
              provider: 'meta',
              selectedId: id,
              selectedName: picked?.name || id,
              meta: { adAccountId: safeStr(ASM.data.metaPixelsMeta?.adAccountId || ''), source: 'asm' },
            });
          }
        }

        if (ASM.visible.googleConversion) {
          const rn = Array.from(ASM.sel.googleConversion)[0] || null;
          const picked = ASM.data.googleConversions.find((x) => safeStr(x.resourceName) === safeStr(rn));
          if (rn) {
            await _post('/api/pixels/select', {
              provider: 'google_ads',
              selectedId: rn,
              selectedName: picked?.name || rn,
              meta: { customerId: safeStr(ASM.data.googleConversionsMeta?.customerId || ''), source: 'asm' },
            });
          }
        }

        _closeModalEl(modal);

        const detail = {
          metaPixel: Array.from(ASM.sel.metaPixel).slice(0, 1),
          googleConversion: Array.from(ASM.sel.googleConversion).slice(0, 1),
          only: ASM.only,
          mode: 'settings',
        };

        window.dispatchEvent(new CustomEvent('adnova:pixels-selection-saved', { detail }));
        window.dispatchEvent(new CustomEvent('adray:pixels-selection-saved', { detail }));
      } catch (e) {
        console.error('save pixel selection error', e);

        const box = _el('pxm-error');
        if (box) {
          box.textContent = 'Ocurrió un error guardando tu selección. Intenta de nuevo.';
          _showEl(box);
        }
        _hint('', 'info', 'pixel-select-modal');

        saveBtn.textContent = originalText || 'Guardar selección';
        _enableSave(_canSavePixels(), 'pxm-save');
      }
    };
  }

  /* =========================================================
   * Public API: openAccountSelectModal / openPixelSelectModal
   * =======================================================*/
  async function openAccountSelectModal(opts = {}) {
    const only = opts.only || 'all';
    const showAll = !!opts.showAll;
    const required = opts.required || {};

    ASM.mode = 'settings';
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

    const tasks = [];
    if (only === 'all' || only === 'meta') tasks.push(_loadMeta().catch(console.error));
    if (only === 'all' || only === 'googleAds' || only === 'googleGa') tasks.push(_loadGoogle().catch(console.error));

    await Promise.allSettled(tasks);

    const mustOpen = ASM.visible.meta || ASM.visible.googleAds || ASM.visible.googleGa;

    if (!mustOpen) {
      window.dispatchEvent(new CustomEvent('adnova:accounts-selection-not-needed', { detail: { only, showAll, required: ASM.required } }));
      window.dispatchEvent(new CustomEvent('adray:accounts-selection-not-needed', { detail: { only, showAll, required: ASM.required } }));
      return;
    }

    await _openAccountModal();
  }

  async function openPixelSelectModal(opts = {}) {
    const only = opts.only || 'googleConversion'; // metaPixel|googleConversion
    const showAll = !!opts.showAll;
    const required = opts.required || {};

    ASM.mode = 'settings';
    ASM.only = only;
    ASM.showAll = showAll;

    ASM.required.metaPixel = !!required.metaPixel;
    ASM.required.googleConversion = !!required.googleConversion;

    ASM.sel.metaPixel.clear();
    ASM.sel.googleConversion.clear();

    ASM.visible.metaPixel = false;
    ASM.visible.googleConversion = false;

    const tasks = [];
    if (only === 'metaPixel') tasks.push(_loadMetaPixels().catch(console.error));
    if (only === 'googleConversion') tasks.push(_loadGoogleConversions().catch(console.error));

    await Promise.allSettled(tasks);

    const mustOpen = ASM.visible.metaPixel || ASM.visible.googleConversion;

    if (!mustOpen) {
      window.dispatchEvent(new CustomEvent('adnova:pixels-selection-not-needed', { detail: { only, showAll, required: ASM.required } }));
      window.dispatchEvent(new CustomEvent('adray:pixels-selection-not-needed', { detail: { only, showAll, required: ASM.required } }));
      return;
    }

    await _openPixelModal();
  }

  /* =========================================================
   * Exports / event bridge (para React / Settings)
   * =======================================================*/
  window.ADNOVA_ASM = window.ADNOVA_ASM || {};
  window.ADNOVA_ASM.openAccountSelectModal = openAccountSelectModal;
  window.ADNOVA_ASM.openPixelSelectModal = openPixelSelectModal;

  window.addEventListener('adnova:open-account-select', (ev) => {
    const d = ev?.detail || {};
    openAccountSelectModal({
      only: d.only || 'all',
      showAll: !!d.showAll,
      required: d.required || {},
    }).catch(console.error);
  });

  window.addEventListener('adray:open-account-select', (ev) => {
    const d = ev?.detail || {};
    openAccountSelectModal({
      only: d.only || 'all',
      showAll: !!d.showAll,
      required: d.required || {},
    }).catch(console.error);
  });

  window.addEventListener('adnova:open-pixel-select', (ev) => {
    const d = ev?.detail || {};
    openPixelSelectModal({
      only: d.only || 'googleConversion',
      showAll: !!d.showAll,
      required: d.required || {},
    }).catch(console.error);
  });

  window.addEventListener('adray:open-pixel-select', (ev) => {
    const d = ev?.detail || {};
    openPixelSelectModal({
      only: d.only || 'googleConversion',
      showAll: !!d.showAll,
      required: d.required || {},
    }).catch(console.error);
  });

  /* =========================================================
   * Auto-open al regresar de OAuth (Settings)
   * =======================================================*/
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

    return { only, required };
  }

  function _isSettingsRoute() {
    try {
      const p = window.location.pathname || '';
      return p.endsWith('/settings') || p.includes('/settings');
    } catch {
      return false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (!_isSettingsRoute()) return;

      const info = _inferAutoOpenFromQS();
      if (!info) return;

      openAccountSelectModal({
        only: info.only,
        showAll: false,
        required: info.required,
      }).catch(console.error);
    } catch (e) {
      console.error('ASM auto-open error', e);
    }
  });
})();