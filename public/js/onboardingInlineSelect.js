// public/js/onboardingInlineSelect.js

// --- helpers fetch JSON / POST ---
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
    body: JSON.stringify(b || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// === límite por bloque ===
const MAX_SELECT = 1;

// --- state ---
const ASM = {
  needs: { meta: false, googleAds: false, googleGA: false },
  data: { meta: [], googleAds: [], googleGA: [] },
  sel: { meta: new Set(), googleAds: new Set(), googleGA: new Set() },
  visible: { meta: false, googleAds: false, googleGA: false }
};

// --- UI utils ---
const _el = (id) => document.getElementById(id);
const _show = (el) => { if (el) { el.classList.remove('hidden'); el.style.display = ''; } };
const _hide = (el) => { if (el) { el.classList.add('hidden'); el.style.display = 'none'; } };

function _hint(text, type = 'info') {
  const box = _el('asm-hint');
  if (!box) return;
  box.textContent = text || '';
  box.style.color =
    type === 'warn' ? '#f59e0b' :
    type === 'error' ? '#ef4444' :
    '#a1a1aa';
  text ? _show(box) : _hide(box);
}

function _enableSave(enabled) {
  const btn = _el('asm-save');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle('asm-btn-primary--disabled', !enabled);
}

function _canSave() {
  if (ASM.visible.meta && ASM.needs.meta && ASM.sel.meta.size === 0) return false;
  if (ASM.visible.googleAds && ASM.needs.googleAds && ASM.sel.googleAds.size === 0) return false;
  if (ASM.visible.googleGA && ASM.needs.googleGA && ASM.sel.googleGA.size === 0) return false;
  return true;
}

function _updateCount(kind) {
  const map = {
    meta: 'asm-meta-count',
    googleAds: 'asm-google-ads-count',
    googleGA: 'asm-google-ga-count'
  };
  const span = _el(map[kind]);
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

function _updateLimitUI(kind) {
  const set = ASM.sel[kind];
  const reached = set.size >= MAX_SELECT;
  const containerMap = {
    meta: 'asm-meta-list',
    googleAds: 'asm-google-ads-list',
    googleGA: 'asm-google-ga-list'
  };
  const list = _el(containerMap[kind]);
  if (!list) return;

  list.querySelectorAll('input[type="checkbox"]').forEach(ch => {
    ch.disabled = !set.has(ch.value) && reached;
  });

  _updateCount(kind);
  if (reached) _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn');
  else _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info');

  _enableSave(_canSave());
}

// --- Eventos de comunicación con onboarding.js ---
function _notifyGoogleAdsSelection(ids) {
  window.dispatchEvent(new CustomEvent('googleAccountsSelected', { detail: { accountIds: ids } }));
}
function _notifyGoogleGASelection(ids) {
  window.dispatchEvent(new CustomEvent('googleAnalyticsSelected', { detail: { propertyIds: ids } }));
}

// --- Render principal ---
function _renderLists() {
  _hint(`Selecciona hasta ${MAX_SELECT} cuenta por tipo.`, 'info');

  // META
  const metaTitle = _el('asm-meta-title');
  const metaList = _el('asm-meta-list');
  if (ASM.visible.meta && ASM.needs.meta && ASM.data.meta.length > 0) {
    _show(metaTitle); _show(metaList);
    metaList.innerHTML = '';
    ASM.data.meta.forEach(a => {
      const id = String(a.id || a.account_id || '').replace(/^act_/, '');
      const name = a.name || a.account_name || id;
      const chip = _chip(name, id, 'meta', (checked, val, kind, cb) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) { cb.checked = false; return _hint(`Solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn'); }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      metaList.appendChild(chip);
    });
    _updateLimitUI('meta');
  } else { _hide(metaTitle); _hide(metaList); }

  // GOOGLE ADS
  const adsTitle = _el('asm-google-ads-title');
  const adsList = _el('asm-google-ads-list');
  if (ASM.visible.googleAds && ASM.needs.googleAds && ASM.data.googleAds.length > 0) {
    _show(adsTitle); _show(adsList);
    adsList.innerHTML = '';
    ASM.data.googleAds.forEach(a => {
      const id = String(a.id || '').replace(/^customers\//, '').replace(/-/g, '').trim();
      const name = a.name || a.descriptiveName || a.descriptive_name || `Cuenta ${id}`;
      const chip = _chip(name, id, 'googleAds', (checked, val, kind, cb) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) { cb.checked = false; return _hint(`Solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn'); }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      adsList.appendChild(chip);
    });
    _updateLimitUI('googleAds');
  } else { _hide(adsTitle); _hide(adsList); }

  // GOOGLE ANALYTICS (GA4)
  const gaTitle = _el('asm-google-ga-title');
  const gaList = _el('asm-google-ga-list');
  if (ASM.visible.googleGA && ASM.needs.googleGA && ASM.data.googleGA.length > 0) {
    _show(gaTitle); _show(gaList);
    gaList.innerHTML = '';
    ASM.data.googleGA.forEach(p => {
      const id = String(p.id || p.property || '').replace(/^properties\//, '');
      const name = p.displayName || p.name || `Propiedad ${id}`;
      const chip = _chip(name, id, 'googleGA', (checked, val, kind, cb) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) { cb.checked = false; return _hint(`Solo puedes seleccionar ${MAX_SELECT} propiedad.`, 'warn'); }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      gaList.appendChild(chip);
    });
    _updateLimitUI('googleGA');
  } else { _hide(gaTitle); _hide(gaList); }

  _enableSave(_canSave());
}

// --- Apertura del modal ---
async function _openModal() {
  _renderLists();
  _show(_el('account-select-modal'));

  const saveBtn = _el('asm-save');
  saveBtn.onclick = async () => {
    if (!_canSave()) return;
    saveBtn.textContent = 'Guardando…';
    saveBtn.disabled = true;

    try {
      const tasks = [];

      // Meta
      if (ASM.visible.meta && ASM.needs.meta) {
        const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
        tasks.push(_post('/api/meta/accounts/selection', { accountIds: ids }));
      }

      // Google Ads
      if (ASM.visible.googleAds && ASM.needs.googleAds) {
        const ids = Array.from(ASM.sel.googleAds).slice(0, MAX_SELECT);
        _notifyGoogleAdsSelection(ids);
      }

      // Google Analytics
      if (ASM.visible.googleGA && ASM.needs.googleGA) {
        const ids = Array.from(ASM.sel.googleGA).slice(0, MAX_SELECT);
        _notifyGoogleGASelection(ids);
      }

      await Promise.all(tasks);
      sessionStorage.setItem('metaConnected', 'true');
      _hide(_el('account-select-modal'));
      window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
    } catch (e) {
      console.error('save selection error', e);
      const errBox = _el('asm-error');
      if (errBox) { errBox.textContent = 'Error guardando tu selección. Intenta nuevamente.'; _show(errBox); }
      _hint('', 'info');
      saveBtn.textContent = 'Guardar y continuar';
      _enableSave(true);
    }
  };
}

// --- Flujo principal ---
async function _maybeOpenSelectionModal() {
  const url = new URL(location.href);
  const fromMeta = url.searchParams.has('meta');
  const fromGoogle = url.searchParams.has('google');

  const metaAlready = sessionStorage.getItem('metaConnected') === 'true';
  const googAlready = sessionStorage.getItem('googleConnected') === 'true';

  ASM.visible.meta = fromMeta && !metaAlready;
  ASM.visible.googleAds = fromGoogle && !googAlready;
  ASM.visible.googleGA = fromGoogle && !googAlready;

  if (!ASM.visible.meta && !ASM.visible.googleAds && !ASM.visible.googleGA) return;

  const promises = [];

  // Meta
  if (ASM.visible.meta) {
    promises.push(
      _json('/api/meta/accounts').then(v => {
        ASM.data.meta = (v.accounts || v.ad_accounts || []).map(a => ({
          id: String(a.id || a.account_id || '').replace(/^act_/, ''),
          name: a.name || a.account_name || ''
        }));
        ASM.needs.meta = ASM.data.meta.length > 2;
        if (!ASM.needs.meta && ASM.data.meta.length) {
          const ids = ASM.data.meta.map(a => a.id).slice(0, MAX_SELECT);
          return _post('/api/meta/accounts/selection', { accountIds: ids })
            .then(() => sessionStorage.setItem('metaConnected', 'true'))
            .catch(() => {});
        }
      })
    );
  }

  // Google Ads
  if (ASM.visible.googleAds) {
    promises.push(
      _json('/api/google/ads/insights/accounts').then(v => {
        ASM.data.googleAds = (v.accounts || []).map(a => ({
          id: String(a.id || '').replace(/^customers\//, '').replace(/-/g, '').trim(),
          name: a.name || a.descriptiveName || a.descriptive_name || ''
        }));
        ASM.needs.googleAds = ASM.data.googleAds.length > 2;
        if (!ASM.needs.googleAds && ASM.data.googleAds.length) {
          const ids = ASM.data.googleAds.map(a => a.id).slice(0, MAX_SELECT);
          _notifyGoogleAdsSelection(ids);
        }
      })
    );
  }

  // Google Analytics (GA4)
  if (ASM.visible.googleGA) {
    promises.push(
      _json('/api/google/analytics/accounts').then(v => {
        ASM.data.googleGA = (v.properties || []).map(p => ({
          id: String(p.name || '').replace(/^properties\//, ''),
          displayName: p.displayName || p.name || ''
        }));
        ASM.needs.googleGA = ASM.data.googleGA.length > 2;
        if (!ASM.needs.googleGA && ASM.data.googleGA.length) {
          const ids = ASM.data.googleGA.map(p => p.id).slice(0, MAX_SELECT);
          _notifyGoogleGASelection(ids);
        }
      })
    );
  }

  await Promise.allSettled(promises);

  if (ASM.needs.meta || ASM.needs.googleAds || ASM.needs.googleGA) await _openModal();
}

document.addEventListener('DOMContentLoaded', () => {
  const url = new URL(location.href);
  const cameFromMeta = url.searchParams.has('meta');
  const cameFromGoogle = url.searchParams.has('google');
  if (cameFromMeta || cameFromGoogle) _maybeOpenSelectionModal().catch(console.error);
});
