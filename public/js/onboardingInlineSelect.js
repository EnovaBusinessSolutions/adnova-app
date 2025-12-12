// public/js/onboardingInlineSelect.js
'use strict';

// --- helpers fetch JSON / POST
async function _json(u) {
  const r = await fetch(u, { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function _post(u, b) {
  const r = await fetch(u, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b || {}),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// === hard limit por plataforma / tipo ===
const MAX_SELECT = 1;

// --- normalizers (alineado con backend)
const normActId = (s = '') => String(s || '').trim().replace(/^act_/, '');
const toActId = (s = '') => {
  const id = normActId(s);
  return id ? `act_${id}` : '';
};
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

// --- state
const ASM = {
  // modo: "oauth" (onboarding) o "manual" (integraciones)
  mode: 'oauth',
  force: false,

  needs: {
    meta: false,
    googleAds: false,
    googleGa: false,
  },
  data: {
    meta: [],
    googleAds: [],
    googleGa: [],
  },
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
};

// --- UI utils
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
  const needsM = ASM.visible.meta && ASM.needs.meta;
  const needsGA = ASM.visible.googleAds && ASM.needs.googleAds;
  const needsGP = ASM.visible.googleGa && ASM.needs.googleGa;

  if (needsM && ASM.sel.meta.size === 0) return false;
  if (needsGA && ASM.sel.googleAds.size === 0) return false;
  if (needsGP && ASM.sel.googleGa.size === 0) return false;
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

/** Aplica UI de límite: deshabilita no seleccionados cuando size >= MAX_SELECT */
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

  if (reached)
    _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn');
  else _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info');

  _enableSave(_canSave());
}

/* =========================================================
 *  ✅ FIX E2E: Esperar ACK de Google Ads selection
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
      detail: { accountIds: ids, reqId, source: ASM.mode === 'manual' ? 'integrations' : 'asm' },
    })
  );

  await _waitForAck('adnova:google-ads-selection-saved', reqId, timeoutMs);
}

/* =========================
 * Render / Modal
 * ========================= */
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
      const displayName = p.displayName || p.name || id;

      // Marcamos seleccionado si coincide por forma raw o por digits
      const isChecked =
        ASM.sel.googleGa.has(id) ||
        (normGA4Id(id) && ASM.sel.googleGa.has(normGA4Id(id)));

      const chip = _chip(displayName, id, 'googleGa', isChecked, (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];

        // Guardamos tal cual (raw) para POST, pero también limpiamos duplicados por norm
        const valNorm = normGA4Id(val);

        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn');
          }
          set.clear(); // UX: 1 por tipo, evitamos valores inconsistentes
          set.add(val); // raw
          if (valNorm) set.add(valNorm); // soporte comparaciones
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

      // META (POST directo)
      if (ASM.visible.meta) {
        const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
        if (ids.length) tasks.push(_post('/api/meta/accounts/selection', { accountIds: ids }));
      }

      // GA4 (POST directo) — mandamos RAW si existe (properties/123), si no, digits
      if (ASM.visible.googleGa) {
        const rawIds = Array.from(ASM.sel.googleGa)
          .filter(Boolean)
          .filter((x) => String(x).includes('properties/') || !String(x).match(/^\d+$/) ? true : true);

        // preferimos el primer valor "properties/xxx" si existe
        let chosen = rawIds.find((x) => String(x).includes('properties/')) || rawIds[0];
        if (!chosen) {
          const any = Array.from(ASM.sel.googleGa)[0];
          chosen = any || null;
        }

        if (chosen) {
          tasks.push(_post('/api/google/analytics/selection', { propertyIds: [chosen] }));
        }
      }

      // Google Ads (ESPERA ACK)
      if (ASM.visible.googleAds) {
        const ids = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
        if (ids.length) tasks.push(_saveGoogleAdsSelection(ids));
      }

      await Promise.all(tasks);

      if (ASM.visible.meta) sessionStorage.setItem('metaConnected', 'true');

      _hide(_el('account-select-modal'));

      // Evento único para onboarding + integraciones
      window.dispatchEvent(
        new CustomEvent('adnova:accounts-selection-saved', {
          detail: {
            meta: Array.from(ASM.sel.meta).slice(0, 1),
            googleAds: Array.from(ASM.sel.googleAds).slice(0, 1),
            ga4: Array.from(ASM.sel.googleGa).filter((x) => String(x).includes('properties/') || String(x).match(/^\d+$/)).slice(0, 1),
            mode: ASM.mode,
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

      saveBtn.textContent = originalText || 'Guardar y continuar';
      _enableSave(_canSave());
    }
  };
}

/* =========================
 * Loader (OAuth / Manual)
 * ========================= */
async function _loadMeta({ force } = {}) {
  // Nota: si tu backend filtra por selección, el “panel” no podrá cambiar de cuenta.
  // Intentamos primero con ?all=1 (si lo implementaste), y si no existe, caemos al endpoint normal.
  let v = null;
  try {
    v = await _json('/api/meta/accounts?all=1');
  } catch {
    v = await _json('/api/meta/accounts');
  }

  const list = (v?.ad_accounts || v?.accounts || []).map((a) => ({
    ...a,
    id: normActId(a.id || a.account_id || ''),
    name: a.name || a.account_name || null,
  }));

  ASM.data.meta = list;

  // Prefill selección si el backend la manda (opcional)
  const selected = Array.isArray(v?.selected) ? v.selected.map(normActId) : [];
  ASM.sel.meta.clear();
  if (selected[0]) ASM.sel.meta.add(selected[0]);

  // En modo OAuth: solo si hay >1 pedimos selector.
  // En modo Manual/Integraciones: mostramos siempre que haya >=1 (para poder cambiar).
  const count = ASM.data.meta.length;
  ASM.needs.meta = count > 1;
  ASM.visible.meta = ASM.mode === 'manual' ? count > 0 : ASM.needs.meta;

  // Autoselección si solo hay 1 (sigue igual para onboarding)
  if (!ASM.visible.meta && count === 1 && (force || ASM.mode === 'oauth')) {
    const id = ASM.data.meta[0].id;
    await _post('/api/meta/accounts/selection', { accountIds: [id] }).catch(() => {});
    sessionStorage.setItem('metaConnected', 'true');
  }
}

async function _loadGoogle({ force } = {}) {
  const st = await _json('/auth/google/status');

  ASM.data.googleAds = Array.isArray(st.ad_accounts) ? st.ad_accounts : [];
  ASM.data.googleGa = Array.isArray(st.gaProperties) ? st.gaProperties : [];

  // Prefill Google Ads selection si viene en status
  const selAds = Array.isArray(st.selectedCustomerIds) ? st.selectedCustomerIds.map(normGadsId) : [];
  ASM.sel.googleAds.clear();
  if (selAds[0]) ASM.sel.googleAds.add(selAds[0]);
  else if (st.defaultCustomerId) ASM.sel.googleAds.add(normGadsId(st.defaultCustomerId));

  // Prefill GA4 selection si viene en status (o default)
  const selGA4 = Array.isArray(st.selectedPropertyIds)
    ? st.selectedPropertyIds.map(String)
    : [];
  ASM.sel.googleGa.clear();
  if (selGA4[0]) {
    ASM.sel.googleGa.add(selGA4[0]);
    ASM.sel.googleGa.add(normGA4Id(selGA4[0]));
  } else if (st.defaultPropertyId) {
    ASM.sel.googleGa.add(String(st.defaultPropertyId));
    ASM.sel.googleGa.add(normGA4Id(st.defaultPropertyId));
  }

  const adsCount = ASM.data.googleAds.length;
  const gaCount = ASM.data.googleGa.length;

  ASM.needs.googleAds = adsCount > 1;
  ASM.needs.googleGa = gaCount > 1;

  ASM.visible.googleAds = ASM.mode === 'manual' ? adsCount > 0 : ASM.needs.googleAds;
  ASM.visible.googleGa = ASM.mode === 'manual' ? gaCount > 0 : ASM.needs.googleGa;

  const autoTasks = [];

  // AUTOPICK Ads si solo hay 1 cuenta (onboarding) → espera ACK
  if (ASM.mode === 'oauth' && !ASM.needs.googleAds && adsCount === 1) {
    const id = normGadsId(ASM.data.googleAds[0].id || '');
    if (id) autoTasks.push(_saveGoogleAdsSelection([id]).catch(() => {}));
  }

  // AUTOPICK GA4 si solo hay 1 propiedad (onboarding)
  if (ASM.mode === 'oauth' && !ASM.needs.googleGa && gaCount === 1) {
    const propertyId =
      ASM.data.googleGa[0].propertyId ||
      ASM.data.googleGa[0].property_id ||
      ASM.data.googleGa[0].name;
    if (propertyId) {
      autoTasks.push(_post('/api/google/analytics/selection', { propertyIds: [propertyId] }).catch(() => {}));
    }
  }

  if (autoTasks.length) await Promise.allSettled(autoTasks);
}

async function openAccountSelectModal({ mode = 'manual', force = true } = {}) {
  // Reseteo básico
  ASM.mode = mode;
  ASM.force = !!force;

  ASM.sel.meta.clear();
  ASM.sel.googleAds.clear();
  ASM.sel.googleGa.clear();

  ASM.visible.meta = false;
  ASM.visible.googleAds = false;
  ASM.visible.googleGa = false;

  const tasks = [];

  // En modo manual (integraciones) NO bloqueamos por sessionStorage.
  // En modo oauth mantenemos el comportamiento actual.
  const metaAlready = sessionStorage.getItem('metaConnected') === 'true';
  const googAlready = sessionStorage.getItem('googleConnected') === 'true';

  if (force || mode === 'manual' || !metaAlready) tasks.push(_loadMeta({ force }).catch(console.error));
  if (force || mode === 'manual' || !googAlready) tasks.push(_loadGoogle({ force }).catch(console.error));

  await Promise.allSettled(tasks);

  // Abrimos si hay algo que mostrar
  const mustOpen = ASM.visible.meta || ASM.visible.googleAds || ASM.visible.googleGa;
  if (mustOpen) await _openModal();
}

// Exponemos para panel de Integraciones
window.ADNOVA_ASM = window.ADNOVA_ASM || {};
window.ADNOVA_ASM.openAccountSelectModal = openAccountSelectModal;

// También permitimos abrirlo por evento desde cualquier UI (React o HTML)
window.addEventListener('adnova:open-account-select', (ev) => {
  const detail = ev?.detail || {};
  openAccountSelectModal({
    mode: detail.mode || 'manual',
    force: detail.force !== false,
  }).catch(console.error);
});

/* =========================
 * Hook actual (OAuth return)
 * ========================= */
async function _maybeOpenSelectionModal() {
  const url = new URL(location.href);
  const fromMeta = url.searchParams.has('meta');
  const fromGoogle = url.searchParams.has('google');

  if (!fromMeta && !fromGoogle) return;

  // comportamiento actual: solo cuando volvemos del OAuth
  await openAccountSelectModal({ mode: 'oauth', force: false });
}

document.addEventListener('DOMContentLoaded', () => {
  _maybeOpenSelectionModal().catch(console.error);
});
