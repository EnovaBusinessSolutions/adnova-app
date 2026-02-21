'use strict';

/**
 * =========================================================
 * ✅ Guard anti doble-carga (FIX de: MAX_SELECT already declared)
 * - Si el script se inyecta 2 veces, no vuelve a ejecutar nada.
 * =========================================================
 */
(function () {
  try {
    if (window.__ADNOVA_ASM_LOADED__) {
      // ya está inicializado
      return;
    }
    window.__ADNOVA_ASM_LOADED__ = true;
  } catch {
    // si algo raro pasa, seguimos (pero casi nunca)
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

  /* =========================================================
   * State (YA NO onboarding)
   * =======================================================*/
  const ASM = {
    mode: 'settings',
    force: true,
    only: 'all',
    showAll: false,

    data: { meta: [], googleAds: [], googleGa: [] },

    // selected (✅ GA4: guardamos SOLO 1 valor RAW (properties/xxx))
    sel: {
      meta: new Set(),
      googleAds: new Set(),
      googleGa: new Set(),
    },

    visible: {
      meta: false,
      googleAds: false,
      googleGa: false,
    },

    required: {
      meta: false,
      googleAds: false,
      googleGa: false,
    },
  };

  /* =========================================================
   * UI utils
   * =======================================================*/
  const _el = (id) => document.getElementById(id);
  const _show = (el) => {
    if (el) {
      el.classList.remove('hidden');
      el.style.display = '';
    }
  };
  const _hide = (el) => {
    if (el) {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  };

  function _ensureHintNode() {
    let hint = _el('asm-hint');
    if (!hint) {
      const panel = _el('account-select-modal')?.querySelector('.asm-panel');
      if (panel) {
        hint = document.createElement('div');
        hint.id = 'asm-hint';
        hint.style.margin = '8px 0 0';
        hint.style.fontSize = '.9rem';
        hint.style.opacity = '0.85';
        panel.insertBefore(hint, panel.querySelector('.asm-footer'));
      }
    }
    return hint;
  }
  function _hint(text, type = 'info') {
    const box = _ensureHintNode();
    if (!box) return;
    box.textContent = text || '';
    box.style.color =
      type === 'warn'
        ? '#f59e0b'
        : type === 'error'
        ? '#ef4444'
        : '#a1a1aa';
    text ? _show(box) : _hide(box);
  }

  function _enableSave(enabled) {
    const btn = _el('asm-save');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('asm-btn-primary--disabled', !enabled);
  }

  function _canSave() {
    if (ASM.visible.meta && ASM.required.meta && ASM.sel.meta.size === 0) return false;
    if (ASM.visible.googleAds && ASM.required.googleAds && ASM.sel.googleAds.size === 0) return false;
    if (ASM.visible.googleGa && ASM.required.googleGa && ASM.sel.googleGa.size === 0) return false;
    return true;
  }

  // ✅ count correcto para GA4 (siempre 0/1)
  function _countFor(kind) {
    if (kind === 'googleGa') return ASM.sel.googleGa.size ? 1 : 0;
    return ASM.sel[kind].size;
  }

  function _updateCount(kind) {
    let spanId;
    if (kind === 'meta') spanId = 'asm-meta-count';
    else if (kind === 'googleAds') spanId = 'asm-google-ads-count';
    else spanId = 'asm-google-ga-count';

    const span = _el(spanId);
    if (span) span.textContent = `${_countFor(kind)}/${MAX_SELECT}`;
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
    wrap.appendChild(document.createTextNode(' ' + label));
    return wrap;
  }

  /** Límite UI */
  function _updateLimitUI(kind) {
    const reached = _countFor(kind) >= MAX_SELECT;

    let containerId;
    if (kind === 'meta') containerId = 'asm-meta-list';
    else if (kind === 'googleAds') containerId = 'asm-google-ads-list';
    else containerId = 'asm-google-ga-list';

    const list = _el(containerId);
    if (!list) return;

    list.querySelectorAll('input[type="checkbox"]').forEach((ch) => {
      // ✅ GA4: si ya hay 1 seleccionado, deshabilita los demás
      if (kind === 'googleGa') {
        const anySelected = ASM.sel.googleGa.size > 0;
        if (!anySelected) ch.disabled = false;
        else ch.disabled = !ASM._isGoogleGaChecked?.(ch.value);
        return;
      }

      // Meta/Ads normal
      if (ASM.sel[kind].has(ch.value)) ch.disabled = false;
      else ch.disabled = reached;
    });

    _updateCount(kind);

    if (reached) _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn');
    else _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info');

    _enableSave(_canSave());
  }

  /* =========================================================
   * ✅ Inyectar modal + estilos si NO existe
   * =======================================================*/
  function _ensureModalSkeleton() {
    if (_el('account-select-modal')) return;

    if (!document.getElementById('asm-styles')) {
      const style = document.createElement('style');
      style.id = 'asm-styles';
      style.textContent = `
        #account-select-modal.hidden { display:none !important; }
        #account-select-modal { position: fixed; inset: 0; z-index: 99999; display: none; }
        #account-select-modal .asm-backdrop{ position: absolute; inset:0; background: rgba(0,0,0,.65); backdrop-filter: blur(6px); }
        #account-select-modal .asm-panel{
          position: relative;
          width: min(860px, calc(100vw - 28px));
          max-height: calc(100vh - 28px);
          margin: 14px auto;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(10,10,14,.92);
          color: #e5e7eb;
          border-radius: 16px;
          box-shadow: 0 24px 80px rgba(0,0,0,.55);
          overflow: hidden;
          display:flex; flex-direction:column;
        }
        #account-select-modal .asm-head{ padding: 14px 16px; display:flex; align-items:center; justify-content:space-between; border-bottom: 1px solid rgba(255,255,255,.08); }
        #account-select-modal .asm-title{ font-weight: 700; font-size: 14px; letter-spacing: .2px; display:flex; gap:8px; align-items:center; }
        #account-select-modal .asm-x{ appearance:none; border:0; background: transparent; color:#cbd5e1; cursor:pointer; padding: 8px 10px; border-radius: 10px; }
        #account-select-modal .asm-x:hover{ background: rgba(255,255,255,.06); }
        #account-select-modal .asm-body{ padding: 14px 16px; overflow:auto; }
        #account-select-modal .asm-sub{ color:#a1a1aa; font-size: 12px; margin-top: 4px; }
        #account-select-modal .asm-section{ margin-top: 14px; }
        #account-select-modal .asm-section h4{ margin: 0 0 8px 0; font-size: 13px; font-weight: 700; }
        #account-select-modal .asm-list{ display:flex; flex-wrap:wrap; gap:10px; }
        #account-select-modal .asm-chip{
          display:flex; align-items:center; gap:10px;
          padding: 10px 12px;
          border: 1px solid rgba(255,255,255,.10);
          border-radius: 12px;
          cursor: pointer;
          background: rgba(255,255,255,.03);
          user-select:none;
          min-width: 220px;
        }
        #account-select-modal .asm-chip:hover{ background: rgba(255,255,255,.06); }
        #account-select-modal .asm-chip input{ transform: scale(1.1); }
        #account-select-modal .asm-footer{ padding: 12px 16px; display:flex; gap:10px; justify-content:flex-end; align-items:center; border-top: 1px solid rgba(255,255,255,.08); }
        #account-select-modal .asm-err{ color:#ef4444; font-size: 12px; margin-top: 10px; display:none; }
        .asm-btn{ appearance:none; border:1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color:#e5e7eb; padding: 10px 12px; border-radius: 12px; cursor:pointer; font-weight: 600; font-size: 13px; }
        .asm-btn:hover{ background: rgba(255,255,255,.10); }
        .asm-btn-primary{ background: #7c3aed; border-color: transparent; color:#fff; }
        .asm-btn-primary:hover{ background: #6d28d9; }
        .asm-btn-primary--disabled{ opacity:.55; cursor:not-allowed; }
        .asm-count{ margin-left: 8px; color:#94a3b8; font-weight: 600; font-size: 12px; }
      `;
      document.head.appendChild(style);
    }

    const modal = document.createElement('div');
    modal.id = 'account-select-modal';
    modal.className = 'hidden';
    modal.innerHTML = `
      <div class="asm-backdrop" id="asm-backdrop"></div>
      <div class="asm-panel" role="dialog" aria-modal="true">
        <div class="asm-head">
          <div>
            <div class="asm-title">⚙️ Seleccionar cuentas</div>
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

    const close = () => _hide(modal);
    const b = _el('asm-backdrop');
    const x = _el('asm-close');
    const c = _el('asm-cancel');
    if (b) b.addEventListener('click', close);
    if (x) x.addEventListener('click', close);
    if (c) c.addEventListener('click', close);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = _el('account-select-modal');
        if (m && m.style.display !== 'none') _hide(m);
      }
    });
  }

  /* =========================================================
   * Google Ads selection ACK (igual)
   * =======================================================*/
  function _newReqId() {
    return `asm_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
  function _waitForAck(eventName, reqId, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let done = false;

      const t = setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener(eventName, onAck);
        reject(new Error('GOOGLE_ADS_SELECTION_ACK_TIMEOUT'));
      }, timeoutMs);

      function onAck(ev) {
        const d = ev?.detail || {};
        if (!d || d.reqId !== reqId) return;
        if (done) return;
        done = true;
        clearTimeout(t);
        window.removeEventListener(eventName, onAck);

        if (d.ok === false) reject(new Error(d.error || 'GOOGLE_ADS_SELECTION_FAILED'));
        else resolve(d);
      }

      window.addEventListener(eventName, onAck);
    });
  }
  async function _saveGoogleAdsSelection(ids, { timeoutMs = 12000 } = {}) {
    const reqId = _newReqId();

    window.dispatchEvent(
      new CustomEvent('googleAccountsSelected', {
        detail: { accountIds: ids, reqId, source: 'settings' },
      })
    );

    await _waitForAck('adnova:google-ads-selection-saved', reqId, timeoutMs);
  }

  /* =========================================================
   * Loaders (solo settings)
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

    const selected =
      Array.isArray(v?.selectedAccountIds) ? v.selectedAccountIds :
      Array.isArray(v?.selected) ? v.selected :
      [];
    const def = v?.defaultAccountId || null;

    ASM.sel.meta.clear();
    const first = selected?.[0] ? normActId(selected[0]) : (def ? normActId(def) : '');
    if (first) ASM.sel.meta.add(first);

    const count = ASM.data.meta.length;
    const allow = (ASM.only === 'all' || ASM.only === 'meta');
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
    const selGA4Raw = Array.isArray(st.selectedPropertyIds) ? st.selectedPropertyIds.map((x) => String(x || '').trim()) : [];
    const defGA4Raw = st.defaultPropertyId ? String(st.defaultPropertyId).trim() : '';
    const chosenRaw = selGA4Raw[0] || defGA4Raw;
    if (chosenRaw) ASM.sel.googleGa.add(chosenRaw);

    const adsCount = ASM.data.googleAds.length;
    const gaCount = ASM.data.googleGa.length;

    const allowAds = (ASM.only === 'all' || ASM.only === 'googleAds');
    const allowGa = (ASM.only === 'all' || ASM.only === 'googleGa');

    ASM.visible.googleAds = allowAds && (ASM.showAll ? adsCount > 0 : adsCount > 1);
    ASM.visible.googleGa = allowGa && (ASM.showAll ? gaCount > 0 : gaCount > 1);
  }

  /* =========================================================
   * Render / Modal
   * =======================================================*/
  function _renderLists() {
    const err = _el('asm-error');
    if (err) {
      err.textContent = '';
      _hide(err);
    }

    _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info');

    const metaTitle = _el('asm-meta-title');
    const metaList = _el('asm-meta-list');
    const gAdsTitle = _el('asm-google-ads-title');
    const gAdsList = _el('asm-google-ads-list');
    const gGaTitle = _el('asm-google-ga-title');
    const gGaList = _el('asm-google-ga-list');

    // META
    if (ASM.visible.meta && ASM.data.meta.length > 0) {
      _show(metaTitle);
      _show(metaList);
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
              return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn');
            }
            set.clear();
            set.add(val);
          } else {
            set.delete(val);
          }
          _updateLimitUI(kind);
        });

        metaList.appendChild(chip);
      });

      _updateLimitUI('meta');
    } else {
      _hide(metaTitle);
      _hide(metaList);
    }

    // GOOGLE ADS
    if (ASM.visible.googleAds && ASM.data.googleAds.length > 0) {
      _show(gAdsTitle);
      _show(gAdsList);
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
              return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn');
            }
            set.clear();
            set.add(val);
          } else {
            set.delete(val);
          }
          _updateLimitUI(kind);
        });

        gAdsList.appendChild(chip);
      });

      _updateLimitUI('googleAds');
    } else {
      _hide(gAdsTitle);
      _hide(gAdsList);
    }

    // GOOGLE ANALYTICS (GA4)
    ASM._isGoogleGaChecked = (val) => {
      const pickedRaw = Array.from(ASM.sel.googleGa)[0] || '';
      if (!pickedRaw) return false;
      return normGA4Id(pickedRaw) === normGA4Id(val);
    };

    if (ASM.visible.googleGa && ASM.data.googleGa.length > 0) {
      _show(gGaTitle);
      _show(gGaList);
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
              return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn');
            }
            set.clear();
            set.add(val); // ✅ SOLO RAW
          } else {
            set.clear(); // GA4 es 1 selección
          }
          _updateLimitUI(kind);
        });

        gGaList.appendChild(chip);
      });

      _updateLimitUI('googleGa');
    } else {
      _hide(gGaTitle);
      _hide(gGaList);
    }

    if (!ASM.visible.meta && !ASM.visible.googleAds && !ASM.visible.googleGa) {
      _hint('No hay cuentas suficientes para seleccionar (o solo existe 1 cuenta por tipo).', 'info');
    }

    _enableSave(_canSave());
  }

  async function _openModal() {
    _ensureModalSkeleton();
    _renderLists();
    _show(_el('account-select-modal'));

    const saveBtn = _el('asm-save');
    if (!saveBtn) return;

    saveBtn.onclick = async () => {
      if (!_canSave()) return;

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

        // Google Ads (ACK)
        if (ASM.visible.googleAds) {
          const ids = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
          if (ids.length) tasks.push(_saveGoogleAdsSelection(ids));
        }

        await Promise.all(tasks);

        _hide(_el('account-select-modal'));

        window.dispatchEvent(
          new CustomEvent('adnova:accounts-selection-saved', {
            detail: {
              meta: Array.from(ASM.sel.meta).slice(0, 1),
              googleAds: Array.from(ASM.sel.googleAds).slice(0, 1),
              ga4: Array.from(ASM.sel.googleGa).slice(0, 1), // ✅ RAW
              mode: 'settings',
              only: ASM.only,
            },
          })
        );
      } catch (e) {
        console.error('save selection error', e);

        const box = _el('asm-error');
        if (box) {
          box.textContent =
            e?.message === 'GOOGLE_ADS_SELECTION_ACK_TIMEOUT'
              ? 'No pudimos confirmar el guardado de tu cuenta de Google Ads. Intenta de nuevo.'
              : 'Ocurrió un error guardando tu selección. Intenta de nuevo.';
          _show(box);
        }
        _hint('', 'info');

        saveBtn.textContent = originalText || 'Guardar selección';
        _enableSave(_canSave());
      }
    };
  }

  /* =========================================================
   * Public API: openAccountSelectModal
   * =======================================================*/
  async function openAccountSelectModal(opts = {}) {
    const only = (opts.only || 'all');
    const force = opts.force !== false;
    const showAll = !!opts.showAll;
    const required = opts.required || {};

    ASM.mode = 'settings';
    ASM.only = only;
    ASM.force = force;
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
      window.dispatchEvent(
        new CustomEvent('adnova:accounts-selection-not-needed', {
          detail: { only, showAll, required: ASM.required },
        })
      );
      return;
    }

    await _openModal();
  }

  /* =========================================================
   * Exports / event bridge (para React Settings)
   * =======================================================*/
  window.ADNOVA_ASM = window.ADNOVA_ASM || {};
  window.ADNOVA_ASM.openAccountSelectModal = openAccountSelectModal;

  window.addEventListener('adnova:open-account-select', (ev) => {
    const d = ev?.detail || {};
    openAccountSelectModal({
      only: d.only || 'all',
      force: d.force !== false,
      showAll: !!d.showAll,
      required: d.required || {},
    }).catch(console.error);
  });

  /* =========================================================
   * Auto-open al regresar de OAuth
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
        force: true,
        showAll: false,
        required: info.required,
      }).catch(console.error);
    } catch (e) {
      console.error('ASM auto-open error', e);
    }
  });

})();