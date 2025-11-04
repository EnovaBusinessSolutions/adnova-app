// public/js/onboardingInlineSelect.js

// --- helpers fetch JSON / POST
async function _json(u){
  const r = await fetch(u, { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function _post(u, b){
  const r = await fetch(u, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// === hard limit por plataforma ===
const MAX_SELECT = 3;

// --- state
const ASM = {
  needs: { meta:false, google:false },
  data:  { meta:[], google:[] },
  sel:   { meta:new Set(), google:new Set() }
};

// --- UI utils
const _el = (id) => document.getElementById(id);
const _show = (el) => { if (el){ el.classList.remove('hidden'); el.style.display = ''; } };
const _hide = (el) => { if (el){ el.classList.add('hidden'); el.style.display = 'none'; } };

function _ensureHintNode(){
  // Coloca el hint bajo el subtítulo del modal
  let hint = _el('asm-hint');
  if (!hint) {
    const panel = document.querySelector('#account-select-modal .asm-panel');
    if (panel) {
      const sub = panel.querySelector('.asm-sub') || panel;
      hint = document.createElement('div');
      hint.id = 'asm-hint';
      hint.style.margin = '8px 0 0';
      hint.style.fontSize = '.9rem';
      hint.style.opacity = '0.9';
      hint.setAttribute('aria-live', 'polite');
      sub.appendChild(hint);
    }
  }
  return hint;
}
function _hint(text, type = 'info'){
  const box = _ensureHintNode();
  if (!box) return;
  box.textContent = text || '';
  box.style.color = (type === 'warn') ? '#f59e0b' : (type === 'error' ? '#ef4444' : '#a1a1aa');
  text ? _show(box) : _hide(box);
}

function _enableSave(enabled){
  const btn = _el('asm-save');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.classList.toggle('asm-btn-primary--disabled', !enabled);
}

function _canSave(){
  const needsM = ASM.needs.meta;
  const needsG = ASM.needs.google;
  if (needsM && ASM.sel.meta.size   === 0) return false;
  if (needsG && ASM.sel.google.size === 0) return false;
  return true;
}

function _chip(label, value, kind, onChange){
  // kind: 'meta' | 'google'
  const wrap = document.createElement('label');
  wrap.className = 'asm-chip';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = value;

  cb.addEventListener('change', () => onChange(!!cb.checked, value, kind, cb));

  const txt = document.createTextNode(' ' + label);
  wrap.appendChild(cb);
  wrap.appendChild(txt);
  return wrap;
}

function _setCount(kind, n){
  const id = kind === 'meta' ? 'asm-meta-count' : 'asm-google-count';
  const el = _el(id);
  if (el) el.textContent = `${n}/${MAX_SELECT}`;
}

/** Aplica UI de límite: deshabilita no seleccionados cuando size >= MAX_SELECT y actualiza contador */
function _updateLimitUI(kind){
  const set = ASM.sel[kind];
  const reached = set.size >= MAX_SELECT;

  _setCount(kind, set.size);

  const containerId = (kind === 'meta') ? 'asm-meta-list' : 'asm-google-list';
  const list = _el(containerId);
  if (!list) return;

  const checks = list.querySelectorAll('input[type="checkbox"]');
  checks.forEach(ch => {
    if (set.has(ch.value)) {
      ch.disabled = false; // los ya seleccionados siempre se pueden desmarcar
    } else {
      ch.disabled = reached; // si alcanzó límite, deshabilita los no seleccionados
    }
  });

  if (reached) {
    _hint(`Límite alcanzado: solo puedes seleccionar hasta ${MAX_SELECT} cuentas.`, 'warn');
  } else {
    _hint(`Selecciona hasta ${MAX_SELECT} cuentas por plataforma.`, 'info');
  }

  _enableSave(_canSave());
}

function _renderLists(){
  // Limpiar mensajes previos
  const err = _el('asm-error');
  if (err){ err.textContent = ''; _hide(err); }
  _hint(`Selecciona hasta ${MAX_SELECT} cuentas por plataforma.`, 'info');

  // META
  const metaTitle = _el('asm-meta-title');
  const metaList  = _el('asm-meta-list');
  if (metaList) metaList.innerHTML = '';
  ASM.sel.meta.clear(); // reset visual/estado por si se reabre
  _setCount('meta', 0);

  if (ASM.needs.meta && ASM.data.meta.length > 0){
    _show(metaTitle);
    _show(metaList);
    ASM.data.meta.forEach(a => {
      // mostrar bonito, enviar normalizado (el backend acepta con/sin act_)
      const id = String(a.id || a.account_id || '').replace(/^act_/, '');
      const label = a.name || a.account_name || id;
      const chip = _chip(label, id, 'meta', (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) {
            // revertir y avisar
            cbEl.checked = false;
            _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuentas.`, 'warn');
            return;
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
    _hide(metaTitle); _hide(metaList);
  }

  // GOOGLE
  const gTitle = _el('asm-google-title');
  const gList  = _el('asm-google-list');
  if (gList) gList.innerHTML = '';
  ASM.sel.google.clear();
  _setCount('google', 0);

  if (ASM.needs.google && ASM.data.google.length > 0){
    _show(gTitle);
    _show(gList);
    ASM.data.google.forEach(a => {
      const id = String(a.id || '').replace(/^customers\//, '').replace(/-/g,'').trim();
      const label = a.name || `Cuenta ${id}`;
      const chip = _chip(label, id, 'google', (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) {
            cbEl.checked = false;
            _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuentas.`, 'warn');
            return;
          }
          set.add(val);
        } else {
          set.delete(val);
        }
        _updateLimitUI(kind);
      });
      gList.appendChild(chip);
    });
    _updateLimitUI('google');
  } else {
    _hide(gTitle); _hide(gList);
  }

  _enableSave(_canSave());
}

async function _openModal(){
  _renderLists();
  _show(_el('account-select-modal'));

  // Sin cerrar por overlay/ESC (no agregamos listeners)
  const saveBtn = _el('asm-save');
  saveBtn.onclick = async () => {
    // Validación final de límite
    if (ASM.sel.meta.size > MAX_SELECT || ASM.sel.google.size > MAX_SELECT) {
      _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuentas.`, 'warn');
      return;
    }
    if (!_canSave()) return;

    saveBtn.textContent = 'Guardando…';
    saveBtn.disabled = true;

    try {
      const tasks = [];
      if (ASM.needs.meta){
        // Limitar de nuevo por si acaso
        const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
        tasks.push(_post('/api/meta/accounts/selection', { accountIds: ids }));
      }
      if (ASM.needs.google){
        const ids = Array.from(ASM.sel.google).slice(0, MAX_SELECT);
        tasks.push(_post('/api/google/ads/insights/accounts/selection', { accountIds: ids }));
      }
      await Promise.all(tasks);

      if (ASM.needs.meta)   sessionStorage.setItem('metaConnected','true');
      if (ASM.needs.google) sessionStorage.setItem('googleConnected','true');

      // Notifica al resto de la UI (onboarding.js escucha este evento)
      window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));

      _hide(_el('account-select-modal'));
    } catch (e) {
      console.error('save selection error', e);
      const box = _el('asm-error');
      if (box){
        box.textContent = 'Ocurrió un error guardando tu selección. Intenta de nuevo.';
        _show(box);
      }
      _hint('', 'info');
      saveBtn.textContent = 'Guardar y continuar';
      _enableSave(true);
    }
  };
}

async function _maybeOpenSelectionModal(){
  // 1) Traer cuentas una vez finalizado OAuth
  const [m, g] = await Promise.allSettled([
    _json('/api/meta/accounts'),
    _json('/api/google/ads/insights/accounts')
  ]);

  const meta = m.status === 'fulfilled'
    ? (m.value.accounts || m.value.ad_accounts || [])
    : [];
  const goog = g.status === 'fulfilled'
    ? (g.value.accounts || [])
    : [];

  // 2) Reglas de selección → si hay 3+ se abre modal y se limita a 3
  ASM.needs.meta   = meta.length  > 2;
  ASM.needs.google = goog.length  > 2;
  ASM.data.meta    = meta;
  ASM.data.google  = goog;

  // 3) Autoselección cuando hay 1–2 por plataforma
  const calls = [];
  if (!ASM.needs.meta && meta.length > 0){
    const ids = meta.map(a => String(a.id || a.account_id || '').replace(/^act_/, ''));
    calls.push(_post('/api/meta/accounts/selection', {
      accountIds: ids.slice(0, MAX_SELECT)
    }).catch(()=>{}));
    sessionStorage.setItem('metaConnected', '1');
  }
  if (!ASM.needs.google && goog.length > 0){
    const ids = goog.map(a => String(a.id || '').replace(/^customers\//, '').replace(/-/g,'').trim());
    calls.push(_post('/api/google/ads/insights/accounts/selection', {
      accountIds: ids.slice(0, MAX_SELECT)
    }).catch(()=>{}));
    sessionStorage.setItem('googleConnected', '1');
  }
  if (calls.length){
    try { await Promise.all(calls); } catch(_) {}
  }

  // 4) Si alguna plataforma necesita selección, abrir modal
  if (ASM.needs.meta || ASM.needs.google){
    await _openModal();
  }
}

// Hook: cuando volvemos del OAuth (query ?meta=ok o ?google=ok)
document.addEventListener('DOMContentLoaded', () => {
  const url = new URL(location.href);
  const cameFromMeta   = url.searchParams.has('meta');
  const cameFromGoogle = url.searchParams.has('google');
  if (cameFromMeta || cameFromGoogle){
    _maybeOpenSelectionModal().catch(console.error);
  }
});
