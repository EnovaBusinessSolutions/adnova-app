// public/js/onboardingInlineSelect.js

// --- helpers fetch JSON / POST
async function _json(u){ const r=await fetch(u,{credentials:'include'}); if(!r.ok) throw new Error(await r.text()); return r.json(); }
async function _post(u,b){ const r=await fetch(u,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}); if(!r.ok) throw new Error(await r.text()); return r.json(); }

// --- state
const ASM = {
  needs: { meta:false, google:false },
  data:  { meta:[], google:[] },
  sel:   { meta:new Set(), google:new Set() }
};

// --- UI refs
function _el(id){ return document.getElementById(id); }
function _show(el){ el.classList.remove('hidden'); el.style.display='block'; }
function _hide(el){ el.classList.add('hidden'); el.style.display='none'; }

function _enableSave(enabled){
  const btn = _el('asm-save');
  if (!btn) return;
  if (enabled){
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
  } else {
    btn.disabled = true;
    btn.style.opacity = '.6';
    btn.style.cursor  = 'not-allowed';
  }
}

function _drawTabs(){
  const tabs = _el('asm-tabs');
  tabs.innerHTML = '';
  const items = [];
  if (ASM.needs.meta)   items.push({id:'meta',   label:'Meta Business Manager'});
  if (ASM.needs.google) items.push({id:'google', label:'Google Ads'});

  if (items.length<=1){ _hide(tabs); return; }
  _show(tabs);

  items.forEach((it, idx)=>{
    const b = document.createElement('button');
    b.textContent = it.label;
    b.dataset.key = it.id;
    b.className = 'rounded-xl px-3 py-1';
    b.style.background = idx===0 ? '#26273b' : 'transparent';
    b.style.color = '#e9e9f2';
    b.style.border = '1px solid #26273b';
    b.addEventListener('click', ()=>{
      tabs.querySelectorAll('button').forEach(x=>x.style.background='transparent');
      b.style.background='#26273b';
      _drawBody(it.id);
    });
    tabs.appendChild(b);
  });
}

function _drawBody(active){
  const body = _el('asm-body');
  body.innerHTML = '';

  const toPaint = [];
  if (ASM.needs.meta && (!active || active==='meta'))     toPaint.push('meta');
  if (ASM.needs.google && (!active || active==='google')) toPaint.push('google');

  toPaint.forEach(key=>{
    const list = ASM.data[key] || [];
    const sec  = document.createElement('section');
    sec.innerHTML = `
      <h3 style="color:#e9e9f2; font-weight:800; margin-bottom:8px;">${key==='meta'?'Meta Business Manager':'Google Ads'}</h3>
      <div class="flex flex-wrap gap-3"></div>
    `;
    const wrap = sec.querySelector('div');

    list.forEach(acc=>{
      const id = String(acc.id || acc.account_id || '').replace(/^act_/,'');
      const label = acc.name || acc.account_name || id;
      const item  = document.createElement('label');
      item.className = 'rounded-xl px-3 py-2';
      item.style.border = '1px solid #26273b';
      item.style.color  = '#a9aac7';
      item.style.cursor = 'pointer';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = id;
      cb.style.marginRight = '8px';

      cb.addEventListener('change', ()=>{
        if (cb.checked) ASM.sel[key].add(id); else ASM.sel[key].delete(id);
        _enableSave(_canSave());
      });

      item.appendChild(cb);
      item.appendChild(document.createTextNode(label));
      wrap.appendChild(item);
    });

    body.appendChild(sec);
  });

  _enableSave(_canSave());
}

function _canSave(){
  const needsM = ASM.needs.meta, needsG = ASM.needs.google;
  if (needsM && ASM.sel.meta.size===0) return false;
  if (needsG && ASM.sel.google.size===0) return false;
  return true;
}

async function _openModal(){
  _drawTabs();
  _drawBody();
  _show(_el('account-select-modal'));

  // bloquear cierre con ESC / overlay: sin listeners
  _el('asm-save').onclick = async ()=>{
    if (!_canSave()) return;
    _el('asm-save').textContent = 'Guardando…';
    _el('asm-save').disabled = true;

    try {
      const tasks = [];
      if (ASM.needs.meta) {
        tasks.push(_post('/api/meta/accounts/selection', { accountIds: Array.from(ASM.sel.meta) }));
      }
      if (ASM.needs.google) {
        tasks.push(_post('/api/google/ads/insights/accounts/selection', { accountIds: Array.from(ASM.sel.google) }));
      }
      await Promise.all(tasks);

      // marca visual (si ya tienes badges por sessionStorage)
      if (ASM.needs.meta)   sessionStorage.setItem('metaConnected','1');
      if (ASM.needs.google) sessionStorage.setItem('googleConnected','1');

      _hide(_el('account-select-modal'));
    } catch (e) {
      console.error('save selection error', e);
      const box = _el('asm-error');
      box.textContent = 'Ocurrió un error guardando tu selección. Intenta de nuevo.';
      _show(box);
      _enableSave(true);
      _el('asm-save').textContent = 'Guardar y continuar';
    }
  };
}

async function _maybeOpenSelectionModal(){
  // 1) Obtener cuentas (después de OAuth)
  const [m,g] = await Promise.allSettled([
    _json('/api/meta/accounts'),
    _json('/api/google/ads/insights/accounts')
  ]);

  const meta   = m.status==='fulfilled' ? (m.value.accounts || m.value.ad_accounts || []) : [];
  const goog   = g.status==='fulfilled' ? (g.value.accounts || []) : [];

  // 2) Reglas: >2 requiere selección, 1–2 autoselección
  ASM.needs.meta   = meta.length   > 2;
  ASM.needs.google = goog.length   > 2;
  ASM.data.meta    = meta;
  ASM.data.google  = goog;

  const calls = [];
  if (!ASM.needs.meta && meta.length>0) {
    calls.push(_post('/api/meta/accounts/selection', { accountIds: meta.map(a=>a.id) }).catch(()=>{}));
    sessionStorage.setItem('metaConnected','1');
  }
  if (!ASM.needs.google && goog.length>0) {
    calls.push(_post('/api/google/ads/insights/accounts/selection', { accountIds: goog.map(a=>a.id) }).catch(()=>{}));
    sessionStorage.setItem('googleConnected','1');
  }
  if (calls.length) { try{ await Promise.all(calls); }catch(_){} }

  if (ASM.needs.meta || ASM.needs.google){
    await _openModal();
  }
}

// --- hook: cuando regresamos de OAuth detectamos por query
document.addEventListener('DOMContentLoaded', ()=>{
  const url = new URL(location.href);
  const fromMeta   = url.searchParams.has('meta');   // ej: ?meta=ok
  const fromGoogle = url.searchParams.has('google'); // ej: ?google=ok
  if (fromMeta || fromGoogle){
    // Evita que cambie estado visual a "Conectado" sin selección:
    // Si tus cards cambian por JS, considera bloquear ahí hasta cerrar modal.
    _maybeOpenSelectionModal().catch(console.error);
  }
});
