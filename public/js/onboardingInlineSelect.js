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
const MAX_SELECT = 1;

// --- state
const ASM = {
  needs: { meta:false, google:false },
  data:  { meta:[], google:[] },
  sel:   { meta:new Set(), google:new Set() },
  visible: { meta:false, google:false } // qué se muestra en el modal
};

// --- UI utils
const _el = (id) => document.getElementById(id);
const _show = (el) => { if (el){ el.classList.remove('hidden'); el.style.display = ''; } };
const _hide = (el) => { if (el){ el.classList.add('hidden'); el.style.display = 'none'; } };

function _ensureHintNode(){
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
  const needsM = ASM.visible.meta && ASM.needs.meta;
  const needsG = ASM.visible.google && ASM.needs.google;
  if (needsM && ASM.sel.meta.size   === 0) return false;
  if (needsG && ASM.sel.google.size === 0) return false;
  return true;
}

function _updateCount(kind){
  const span = _el(kind === 'meta' ? 'asm-meta-count' : 'asm-google-count');
  if (span) span.textContent = `${ASM.sel[kind].size}/${MAX_SELECT}`;
}

function _chip(label, value, kind, onChange){
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
function _updateLimitUI(kind){
  const set = ASM.sel[kind];
  const reached = set.size >= MAX_SELECT;

  const containerId = (kind === 'meta') ? 'asm-meta-list' : 'asm-google-list';
  const list = _el(containerId);
  if (!list) return;

  list.querySelectorAll('input[type="checkbox"]').forEach(ch => {
    if (set.has(ch.value)) ch.disabled = false;
    else ch.disabled = reached;
  });

  _updateCount(kind);

  if (reached) _hint(`Límite alcanzado: solo puedes seleccionar ${MAX_SELECT} cuenta.`, 'warn');
  else _hint(`Selecciona hasta ${MAX_SELECT} cuenta por plataforma.`, 'info');

  _enableSave(_canSave());
}

function _renderLists(){
  const err = _el('asm-error');
  if (err){ err.textContent = ''; _hide(err); }
  _hint(`Selecciona hasta ${MAX_SELECT} cuenta por plataforma.`, 'info');

  // Mostrar/ocultar títulos según visible.*
  const metaTitle = _el('asm-meta-title');
  const metaList  = _el('asm-meta-list');
  const gTitle    = _el('asm-google-title');
  const gList     = _el('asm-google-list');

  // META
  if (ASM.visible.meta && ASM.needs.meta && ASM.data.meta.length > 0){
    _show(metaTitle); _show(metaList);
    metaList.innerHTML = '';
    ASM.data.meta.forEach(a => {
      const id = String(a.id || a.account_id || '').replace(/^act_/, '');
      const label = a.name || a.account_name || id;
      const chip = _chip(label, id, 'meta', (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) { cbEl.checked = false; return _hint(`Solo puedes seleccionar hast ${MAX_SELECT} cuenta.`, 'warn'); }
          set.add(val);
        } else set.delete(val);
        _updateLimitUI(kind);
      });
      metaList.appendChild(chip);
    });
    _updateLimitUI('meta');
  } else {
    _hide(metaTitle); _hide(metaList);
  }

  // GOOGLE
  if (ASM.visible.google && ASM.needs.google && ASM.data.google.length > 0){
    _show(gTitle); _show(gList);
    gList.innerHTML = '';
    ASM.data.google.forEach(a => {
      const id = String(a.id || '').replace(/^customers\//, '').replace(/-/g,'').trim();
      // 👇 Mostrar nombre humano: name -> descriptiveName -> fallback "Cuenta {id}"
    const displayName = a.name || a.descriptiveName || a.descriptive_name || `Cuenta ${id}`;
      const chip = _chip(displayName, id, 'google', (checked, val, kind, cbEl) => {
        const set = ASM.sel[kind];
        if (checked) {
          if (set.size >= MAX_SELECT) { cbEl.checked = false; return _hint(`Solo puedes seleccionar hasta ${MAX_SELECT} cuenta.`, 'warn'); }
          set.add(val);
        } else set.delete(val);
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

  const saveBtn = _el('asm-save');
  saveBtn.onclick = async () => {
    if (!_canSave()) return;
    saveBtn.textContent = 'Guardando…';
    saveBtn.disabled = true;

    try {
      const tasks = [];

      if (ASM.visible.meta && ASM.needs.meta){
        const ids = Array.from(ASM.sel.meta).slice(0, MAX_SELECT);
        tasks.push(_post('/api/meta/accounts/selection', { accountIds: ids }));
      }
      if (ASM.visible.google && ASM.needs.google){
        const ids = Array.from(ASM.sel.google).slice(0, MAX_SELECT);
        tasks.push(_post('/api/google/ads/insights/accounts/selection', { accountIds: ids }));
      }

      await Promise.all(tasks);

      if (ASM.visible.meta)   sessionStorage.setItem('metaConnected','true');
      if (ASM.visible.google) sessionStorage.setItem('googleConnected','true');

      _hide(_el('account-select-modal'));
      // Notificar a otras partes del onboarding para habilitar "Continuar"
      window.dispatchEvent(new CustomEvent('adnova:accounts-selection-saved'));
    } catch (e) {
      console.error('save selection error', e);
      const box = _el('asm-error');
      if (box){ box.textContent = 'Ocurrió un error guardando tu selección. Intenta de nuevo.'; _show(box); }
      _hint('', 'info');
      saveBtn.textContent = 'Guardar y continuar';
      _enableSave(true);
    }
  };
}

async function _maybeOpenSelectionModal(){
  // ¿Desde qué OAuth venimos?
  const url = new URL(location.href);
  const fromMeta   = url.searchParams.has('meta');
  const fromGoogle = url.searchParams.has('google');

  // Si ya hay selección guardada (o sessionStorage), no pedir de nuevo
  const metaAlready = sessionStorage.getItem('metaConnected') === 'true';
  const googAlready = sessionStorage.getItem('googleConnected') === 'true';

  // Flags de visibilidad: solo la plataforma que detonó el modal
  ASM.visible.meta   = fromMeta   && !metaAlready;
  ASM.visible.google = fromGoogle && !googAlready;

  // Si nada está visible, salir
  if (!ASM.visible.meta && !ASM.visible.google) return;

  // Carga de cuentas SOLO de lo visible
  const promises = [];
  if (ASM.visible.meta){
    promises.push(
      _json('/api/meta/accounts').then(v=>{
        ASM.data.meta = (v.accounts || v.ad_accounts || []).map(a => ({
          ...a,
          id: String(a.id || a.account_id || '').replace(/^act_/, ''),
          name: a.name || a.account_name || null
        }));
        // Se necesita modal si hay 3+
        ASM.needs.meta = (ASM.data.meta.length > 2);
        // Autoselección si 1–2
        if (!ASM.needs.meta && ASM.data.meta.length){
          const ids = ASM.data.meta.map(a => a.id);
          return _post('/api/meta/accounts/selection', { accountIds: ids.slice(0, MAX_SELECT) })
            .then(()=>sessionStorage.setItem('metaConnected','true'))
            .catch(()=>{});
        }
      })
    );
  }

  if (ASM.visible.google){
    promises.push(
      _json('/api/google/ads/insights/accounts').then(v=>{
        // Normalizamos aquí: dejamos siempre name poblado con fallback a descriptiveName
        ASM.data.google = (v.accounts || []).map(a => ({
  ...a,
  id: String(a.id || '').replace(/^customers\//,'').replace(/-/g,'').trim(),
  // name “normalizado” siempre que exista en cualquiera de las claves:
  name: a.name || a.descriptiveName || a.descriptive_name || null,
  descriptiveName: a.descriptiveName || a.descriptive_name || a.name || null
}));
        ASM.needs.google = (ASM.data.google.length > 2);
        if (!ASM.needs.google && ASM.data.google.length){
          const ids = ASM.data.google.map(a => a.id);
          return _post('/api/google/ads/insights/accounts/selection', { accountIds: ids.slice(0, MAX_SELECT) })
            .then(()=>sessionStorage.setItem('googleConnected','true'))
            .catch(()=>{});
        }
      })
    );
  }

  await Promise.allSettled(promises);

  // Si alguna necesita selección, abrir modal (muestra solo lo visible)
  if ((ASM.visible.meta && ASM.needs.meta) || (ASM.visible.google && ASM.needs.google)){
    await _openModal();
  }
}

// Hook: cuando volvemos del OAuth (query ?meta=ok u ?google=ok)
document.addEventListener('DOMContentLoaded', () => {
  const url = new URL(location.href);
  const cameFromMeta   = url.searchParams.has('meta');
  const cameFromGoogle = url.searchParams.has('google');
  if (cameFromMeta || cameFromGoogle){
    _maybeOpenSelectionModal().catch(console.error);
  }
});
