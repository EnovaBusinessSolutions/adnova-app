// public/js/onboardingInlineSelect.js

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

// --- state
const ASM = {
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
    googleGa: false, // qué bloques se muestran en el modal
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

function _chip(label, value, kind, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'asm-chip';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = value;

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
 *  ---------------------------------------------------------
 *  Este script dispara "googleAccountsSelected" para que
 *  onboarding.js haga el POST a:
 *    /api/google/ads/insights/accounts/selection
 *
 *  Para evitar la condición de carrera, NO cerramos modal
 *  hasta recibir:
 *    "adnova:google-ads-selection-saved"
 *
 *  onboarding.js deberá emitir ese evento al terminar.
 * ========================================================= */

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
      if (!d || d.reqId !== reqId) return; // ignorar ACKs de otra ejecución
      if (done) return;
      done = true;
      clearTimeout(t);
      window.removeEventListener(eventName, onAck);

      if (d.ok === false) {
        reject(new Error(d.error || 'GOOGLE_ADS_SELECTION_FAILED'));
      } else {
        resolve(d);
      }
    }

    window.addEventListener(eventName, onAck);
  });
}

/** Notificar selección de cuentas de Google Ads al script principal (onboarding.js) y ESPERAR ACK */
async function _saveGoogleAdsSelection(ids, { timeoutMs = 12000 } = {}) {
  const reqId = _newReqId();

  // Disparamos evento para que onboarding.js haga el POST real
  try {
    window.dispatchEvent(
      new CustomEvent('googleAccountsSelected', {
        detail: { accountIds: ids, reqId, source: 'asm' },
      })
    );
  } catch (e) {
    console.error('Error dispatching googleAccountsSelected', e);
    throw new Error('GOOGLE_ADS_SELECTION_DISPATCH_FAILED');
  }

  // Esperar confirmación (onboarding.js debe emitir este evento al terminar)
  await _waitForAck('adnova:google-ads-selection-saved', reqId, timeoutMs);
}

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
  if (ASM.visible.meta && ASM.needs.meta && ASM.data.meta.length > 0) {
    _show(metaTitle);
    _show(metaList);
    metaList.innerHTML = '';
    ASM.data.meta.forEach((a) => {
      const id = String(a.id || a.account_id || '').replace(/^act_/, '');
      const label = a.name || a.account_name || id;
      const chip = _chip(label, id, 'meta', (checked, val, kind, cbEl) => {
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
  if (ASM.visible.googleAds && ASM.needs.googleAds && ASM.data.googleAds.length > 0) {
    _show(gAdsTitle);
    _show(gAdsList);
    gAdsList.innerHTML = '';
    ASM.data.googleAds.forEach((a) => {
      const id = String(a.id || '')
        .replace(/^customers\//, '')
        .replace(/-/g, '')
        .trim();
      const displayName =
        a.name || a.descriptiveName || a.descriptive_name || `Cuenta ${id}`;
      const chip = _chip(displayName, id, 'googleAds', (checked, val, kind, cbEl) => {
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
  if (ASM.visible.googleGa && ASM.needs.googleGa && ASM.data.googleGa.length > 0) {
    _show(gGaTitle);
    _show(gGaList);
    gGaList.innerHTML = '';
    ASM.data.googleGa.forEach((p) => {
      const id = String(p.propertyId || p.property_id || p.name || '').trim();
      const displayName = p.displayName || p.name || id;
      const chip = _chip(displayName, id, 'googleGa', (checked, val, kind, cbEl) => {
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
      if (ASM.visible.meta && ASM.needs.meta) {
        const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
        tasks.push(_post('/api/meta/accounts/selection', { accountIds: ids }));
      }

      // GA4 (POST directo)
      if (ASM.visible.googleGa && ASM.needs.googleGa) {
        const ids = Array.from(ASM.sel.googleGa).slice(0, MAX_SELECT);
        if (ids.length) {
          tasks.push(_post('/api/google/analytics/selection', { propertyIds: ids }));
        }
      }

      // Google Ads (ESPERA ACK)
      if (ASM.visible.googleAds && ASM.needs.googleAds) {
        const ids = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
        if (ids.length) {
          tasks.push(_saveGoogleAdsSelection(ids));
        }
      }

      await Promise.all(tasks);

      if (ASM.visible.meta) {
        sessionStorage.setItem('metaConnected', 'true');
      }
      // googleConnected se marca en onboarding.js (markGoogleConnected)

      _hide(_el('account-select-modal'));
      window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
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
      _enableSave(true);
    }
  };
}

async function _maybeOpenSelectionModal() {
  const url = new URL(location.href);
  const fromMeta = url.searchParams.has('meta');
  const fromGoogle = url.searchParams.has('google');

  const metaAlready = sessionStorage.getItem('metaConnected') === 'true';
  const googAlready = sessionStorage.getItem('googleConnected') === 'true';

  // Reset visibilidad
  ASM.visible.meta = false;
  ASM.visible.googleAds = false;
  ASM.visible.googleGa = false;

  const loaders = [];

  // --- META ---
  if (fromMeta && !metaAlready) {
    loaders.push(
      _json('/api/meta/accounts').then((v) => {
        ASM.data.meta = (v.accounts || v.ad_accounts || []).map((a) => ({
          ...a,
          id: String(a.id || a.account_id || '').replace(/^act_/, ''),
          name: a.name || a.account_name || null,
        }));

        const count = ASM.data.meta.length;
        ASM.needs.meta = count > 1;
        ASM.visible.meta = ASM.needs.meta;

        // 0 o 1 → autoselección
        if (!ASM.needs.meta && count === 1) {
          const id = ASM.data.meta[0].id;
          return _post('/api/meta/accounts/selection', { accountIds: [id] })
            .then(() => sessionStorage.setItem('metaConnected', 'true'))
            .catch(() => {});
        }
      })
    );
  }

  // --- GOOGLE (Ads + GA4, usando /auth/google/status) ---
  if (fromGoogle && !googAlready) {
    loaders.push(
      _json('/auth/google/status').then(async (st) => {
        ASM.data.googleAds = Array.isArray(st.ad_accounts) ? st.ad_accounts : [];
        ASM.data.googleGa = Array.isArray(st.gaProperties) ? st.gaProperties : [];

        const adsCount = ASM.data.googleAds.length;
        const gaCount = ASM.data.googleGa.length;

        ASM.needs.googleAds = adsCount > 1;
        ASM.needs.googleGa = gaCount > 1;

        ASM.visible.googleAds = ASM.needs.googleAds;
        ASM.visible.googleGa = ASM.needs.googleGa;

        const autoTasks = [];

        // AUTOPICK Ads si solo hay 1 cuenta → DISPARA SELECCIÓN (sin modal)
        if (!ASM.needs.googleAds && adsCount === 1) {
          const id = String(ASM.data.googleAds[0].id || '')
            .replace(/^customers\//, '')
            .replace(/-/g, '')
            .trim();
          if (id) {
            // aquí sí esperamos ACK para evitar carreras
            autoTasks.push(_saveGoogleAdsSelection([id]).catch(() => {}));
          }
        }

        // AUTOPICK GA4 si solo hay 1 propiedad → guardamos selección en backend
        if (!ASM.needs.googleGa && gaCount === 1) {
          const propertyId =
            ASM.data.googleGa[0].propertyId ||
            ASM.data.googleGa[0].property_id ||
            ASM.data.googleGa[0].name;
          if (propertyId) {
            autoTasks.push(
              _post('/api/google/analytics/selection', { propertyIds: [propertyId] }).catch(() => {})
            );
          }
        }

        if (autoTasks.length) {
          await Promise.allSettled(autoTasks);
        }
      })
    );
  }

  if (!loaders.length) return;

  await Promise.allSettled(loaders);

  // Solo abrir si realmente hay alguna sección que NECESITE selección
  const mustOpen =
    (ASM.visible.meta && ASM.needs.meta) ||
    (ASM.visible.googleAds && ASM.needs.googleAds) ||
    (ASM.visible.googleGa && ASM.needs.googleGa);

  if (mustOpen) {
    await _openModal();
  }
}

// Hook: cuando volvemos del OAuth (query ?meta=ok u ?google=ok)
document.addEventListener('DOMContentLoaded', () => {
  const url = new URL(location.href);
  const cameFromMeta = url.searchParams.has('meta');
  const cameFromGoogle = url.searchParams.has('google');
  if (cameFromMeta || cameFromGoogle) {
    _maybeOpenSelectionModal().catch(console.error);
  }
});
