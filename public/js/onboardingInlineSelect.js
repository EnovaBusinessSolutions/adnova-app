// public/js/onboardingInlineSelect.js
'use strict';

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
const MAX_SELECT = 1;

/* =========================================================
 * Normalizers (alineado con backend)
 * =======================================================*/
const normActId = (s = '') => String(s || '').trim().replace(/^act_/, '');
const normGadsId = (s = '') =>
  String(s || '')
    .replace(/^customers\//, '')
    .replace(/[^\d]/g, '')
    .trim();
const normGA4Id = (s = '') => {
  const raw = String(s || '').trim();
  const digits = raw.replace(/^properties\//, '').replace(/[^\d]/g, '');
  return digits || raw.replace(/^properties\//, '').trim();
};

/* =========================================================
 * State (YA NO onboarding)
 * =======================================================*/
const ASM = {
  // "settings" es el único modo ahora (solo para telemetry / source)
  mode: 'settings',
  force: true,

  // Qué se abre (meta/googleAds/googleGa/all)
  only: 'all',

  // si true, mostramos selector aunque haya 1 cuenta (modo “cambiar selección”)
  showAll: false,

  // data
  data: { meta: [], googleAds: [], googleGa: [] },

  // selected
  sel: {
    meta: new Set(),
    googleAds: new Set(),
    googleGa: new Set(),
  },

  // visible blocks
  visible: {
    meta: false,
    googleAds: false,
    googleGa: false,
  },

  // required blocks (si vienes de OAuth, Settings lo decide y lo manda)
  // si required=true y no eliges, no deja guardar
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
  // Si algo es required, debe tener selección.
  if (ASM.visible.meta && ASM.required.meta && ASM.sel.meta.size === 0) return false;
  if (ASM.visible.googleAds && ASM.required.googleAds && ASM.sel.googleAds.size === 0) return false;
  if (ASM.visible.googleGa && ASM.required.googleGa && ASM.sel.googleGa.size === 0) return false;
  return true;
}

function _updateCount(kind) {
  let spanId;
  if (kind === 'meta') spanId = 'asm-meta-count';
  else if (kind === 'googleAds') spanId = 'asm-google-ads-count';
  else spanId = 'asm-google-ga-count';

  const span = _el(spanId);
  if (span) span.textContent = `${ASM.sel[kind].size}/${MAX_SELECT}`;
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

/** Límite UI: deshabilita no seleccionados cuando size >= MAX_SELECT */
function _updateLimitUI(kind) {
  const set = ASM.sel[kind];
  const reached = set.size >= MAX_SELECT;

  let containerId;
  if (kind === 'meta') containerId = 'asm-meta-list';
  else if (kind === 'googleAds') containerId = 'asm-google-ads-list';
  else containerId = 'asm-google-ga-list';

  const list = _el(containerId);
  if (!list) return;

  list.querySelectorAll('input[type="checkbox"]').forEach((ch) => {
    if (set.has(ch.value)) ch.disabled = false;
    else ch.disabled = reached;
  });

  _updateCount(kind);

  if (reached) _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn');
  else _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info');

  _enableSave(_canSave());
}

/* =========================================================
 * Google Ads selection ACK (se queda igual)
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
  // Preferimos canónico
  // - /auth/meta/accounts (nuevo)
  // - fallback legacy /api/meta/accounts
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
  const list = (raw || []).map((a) => {
    const id = normActId(a.account_id || a.id || '');
    return {
      ...a,
      id,
      name: a.name || a.account_name || (id ? `act_${id}` : null),
    };
  }).filter((a) => !!a.id);

  ASM.data.meta = list;

  // Prefill: si backend manda selected/default
  const selected =
    Array.isArray(v?.selectedAccountIds) ? v.selectedAccountIds :
    Array.isArray(v?.selected) ? v.selected :
    [];
  const def = v?.defaultAccountId || null;

  ASM.sel.meta.clear();
  const first = selected?.[0] ? normActId(selected[0]) : (def ? normActId(def) : '');
  if (first) ASM.sel.meta.add(first);

  const count = ASM.data.meta.length;

  // Visible: si only=meta o all; y si showAll o count>1
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

  // Prefill GA4
  ASM.sel.googleGa.clear();
  const selGA4 = Array.isArray(st.selectedPropertyIds) ? st.selectedPropertyIds.map(String) : [];
  const defGA4 = st.defaultPropertyId ? String(st.defaultPropertyId) : '';
  const chosen = selGA4[0] || defGA4;
  if (chosen) {
    ASM.sel.googleGa.add(chosen);
    ASM.sel.googleGa.add(normGA4Id(chosen));
  }

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
  if (ASM.visible.googleGa && ASM.data.googleGa.length > 0) {
    _show(gGaTitle);
    _show(gGaList);
    gGaList.innerHTML = '';

    ASM.data.googleGa.forEach((p) => {
      const raw = String(p.propertyId || p.property_id || p.name || '').trim();
      const id = raw || '';
      const displayName = p.displayName || p.display_name || p.name || id;

      const isChecked =
        ASM.sel.googleGa.has(id) ||
        (normGA4Id(id) && ASM.sel.googleGa.has(normGA4Id(id)));

      const chip = _chip(displayName, id, 'googleGa', isChecked, (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        const valNorm = normGA4Id(val);

        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn');
          }
          set.clear();
          set.add(val);
          if (valNorm) set.add(valNorm);
        } else {
          set.delete(val);
          if (valNorm) set.delete(valNorm);
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

  // Si no hay nada visible, muestra hint claro
  if (!ASM.visible.meta && !ASM.visible.googleAds && !ASM.visible.googleGa) {
    _hint('No hay cuentas suficientes para seleccionar (o solo existe 1 cuenta por tipo).', 'info');
  }

  _enableSave(_canSave());
}

async function _openModal() {
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

      // META — preferimos canónico, fallback legacy
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

      // GA4 — preferimos canónico /auth/google/ga4/selection, fallback legacy
      if (ASM.visible.googleGa) {
        const all = Array.from(ASM.sel.googleGa).filter(Boolean);

        // preferimos "properties/xxx" si existe
        let chosen =
          all.find((x) => String(x).includes('properties/')) ||
          all[0] ||
          null;

        // si chosen es solo dígitos y tenemos en data algo raw, lo convertimos al raw si hay match
        if (chosen && String(chosen).match(/^\d+$/)) {
          const match = (ASM.data.googleGa || []).find((p) => {
            const raw = String(p.propertyId || p.property_id || p.name || '').trim();
            return normGA4Id(raw) === String(chosen);
          });
          const rawMatch = match ? String(match.propertyId || match.property_id || match.name || '').trim() : '';
          if (rawMatch) chosen = rawMatch;
        }

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

      // Google Ads — mantiene ACK flow
      if (ASM.visible.googleAds) {
        const ids = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
        if (ids.length) tasks.push(_saveGoogleAdsSelection(ids));
      }

      await Promise.all(tasks);

      _hide(_el('account-select-modal'));

      // Evento único para Settings
      window.dispatchEvent(
        new CustomEvent('adnova:accounts-selection-saved', {
          detail: {
            meta: Array.from(ASM.sel.meta).slice(0, 1),
            googleAds: Array.from(ASM.sel.googleAds).slice(0, 1),
            ga4: Array.from(ASM.sel.googleGa)
              .filter((x) => String(x).includes('properties/') || String(x).match(/^\d+$/))
              .slice(0, 1),
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
 * Public API: openAccountSelectModal (solo Settings)
 * =======================================================*/
async function openAccountSelectModal(opts = {}) {
  // opts:
  // - only: 'all' | 'meta' | 'googleAds' | 'googleGa'
  // - force: boolean (refresca sí o sí)
  // - showAll: boolean (mostrar selector aunque haya 1 cuenta)
  // - required: {meta, googleAds, googleGa} (para bloquear guardado si falta)
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

  // reset
  ASM.sel.meta.clear();
  ASM.sel.googleAds.clear();
  ASM.sel.googleGa.clear();

  ASM.visible.meta = false;
  ASM.visible.googleAds = false;
  ASM.visible.googleGa = false;

  const tasks = [];

  // Cargamos solo lo necesario
  if (only === 'all' || only === 'meta') tasks.push(_loadMeta().catch(console.error));
  if (only === 'all' || only === 'googleAds' || only === 'googleGa') tasks.push(_loadGoogle().catch(console.error));

  await Promise.allSettled(tasks);

  // Si no hay nada visible, no abras modal (pero notifica)
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
 * ✅ Removido: auto-open por OAuth / DOMContentLoaded
 * - Ya no hay onboarding.
 * - Settings controla cuándo se abre.
 * =======================================================*/