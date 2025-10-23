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

function _chip(label, value, onChange){
  const wrap = document.createElement('label');
  wrap.className = 'asm-chip';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = value;

  cb.addEventListener('change', () => onChange(!!cb.checked, value));

  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(' ' + label));
  return wrap;
}

function _renderLists(){
  // Limpiar error
  const err = _el('asm-error');
  if (err){ err.textContent = ''; _hide(err); }

  // META
  const metaTitle = _el('asm-meta-title');
  const metaList  = _el('asm-meta-list');
  if (metaList) metaList.innerHTML = '';
  if (ASM.needs.meta && ASM.data.meta.length > 0){
    _show(metaTitle);
    _show(metaList);
    ASM.data.meta.forEach(a => {
      // mostrar bonito, enviar normalizado (el backend acepta con/sin act_)
      const id = String(a.id || a.account_id || '').replace(/^act_/, '');
      const label = a.name || a.account_name || id;
      const chip = _chip(label, id, (checked, val) => {
        if (checked) ASM.sel.meta.add(val);
        else ASM.sel.meta.delete(val);
        _enableSave(_canSave());
      });
      metaList.appendChild(chip);
    });
  } else {
    _hide(metaTitle); _hide(metaList);
  }

  // GOOGLE
  const gTitle = _el('asm-google-title');
  const gList  = _el('asm-google-list');
  if (gList) gList.innerHTML = '';
  if (ASM.needs.google && ASM.data.google.length > 0){
    _show(gTitle);
    _show(gList);
    ASM.data.google.forEach(a => {
      const id = String(a.id || '').replace(/^customers\//, '').replace(/-/g,'').trim();
      const label = a.name || `Cuenta ${id}`;
      const chip = _chip(label, id, (checked, val) => {
        if (checked) ASM.sel.google.add(val);
        else ASM.sel.google.delete(val);
        _enableSave(_canSave());
      });
      gList.appendChild(chip);
    });
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
    if (!_canSave()) return;

    saveBtn.textContent = 'Guardando…';
    saveBtn.disabled = true;

    try {
      const tasks = [];
      if (ASM.needs.meta){
        // el backend normaliza y agrega "act_" si hace falta
        tasks.push(_post('/api/meta/accounts/selection', {
          accountIds: Array.from(ASM.sel.meta)
        }));
      }
      if (ASM.needs.google){
        tasks.push(_post('/api/google/ads/insights/accounts/selection', {
          accountIds: Array.from(ASM.sel.google)
        }));
      }
      await Promise.all(tasks);

      if (ASM.needs.meta)   sessionStorage.setItem('metaConnected','true');
      if (ASM.needs.google) sessionStorage.setItem('googleConnected','true');

      _hide(_el('account-select-modal'));
    } catch (e) {
      console.error('save selection error', e);
      const box = _el('asm-error');
      if (box){
        box.textContent = 'Ocurrió un error guardando tu selección. Intenta de nuevo.';
        _show(box);
      }
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

  // 2) Reglas de selección
  ASM.needs.meta   = meta.length  > 2;
  ASM.needs.google = goog.length  > 2;
  ASM.data.meta    = meta;
  ASM.data.google  = goog;

  // 3) Autoselección cuando hay 1–2 por plataforma
  const calls = [];
  if (!ASM.needs.meta && meta.length > 0){
    calls.push(_post('/api/meta/accounts/selection', {
      accountIds: meta.map(a => a.id)
    }).catch(()=>{}));
    sessionStorage.setItem('metaConnected', '1');
  }
  if (!ASM.needs.google && goog.length > 0){
    calls.push(_post('/api/google/ads/insights/accounts/selection', {
      accountIds: goog.map(a => a.id)
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
