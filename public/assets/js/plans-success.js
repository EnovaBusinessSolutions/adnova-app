// --- helpers DOM ---
const $ = (s)=>document.querySelector(s);
const emailEl = $('#email');
const planEl  = $('#plan');
const subEl   = $('#sub');
const chipPlan = $('#chip-plan');
const chipSub  = $('#chip-sub');
const statusLine = $('#statusLine');

function setChip(el, val, state){
  el.querySelector('.val').textContent = val ?? '—';
  el.classList.remove('ok','warn','err');
  if (state) el.classList.add(state);
}

// --- API calls ---
async function getSession(){
  const r = await fetch('/api/session',{ credentials:'include' });
  if (!r.ok) throw new Error('No session');
  return r.json();
}
async function syncStripe(){
  const r = await fetch('/api/stripe/sync',{ method:'POST', credentials:'include' });
  // no importa si falla (409/400 etc), la UI igual refresca
  return r.ok ? r.json() : null;
}

// --- paint ---
function paintSession(sess){
  if(!sess?.authenticated) return;
  const u = sess.user || {};
  emailEl.textContent = u.email || '—';

  const plan = (u.plan || '').toLowerCase() || 'gratis';
  setChip(chipPlan, plan, plan !== 'gratis' ? 'ok' : '');

  const status = (u.subscription?.status || '—').toLowerCase();
  let state = '';
  if(['active','trialing','past_due'].includes(status)) state = 'ok';
  else if(['incomplete','incomplete_expired'].includes(status)) state = 'warn';
  else if(['canceled','unpaid'].includes(status)) state = 'err';
  setChip(chipSub, status || '—', state);
}

// --- flow ---
(async function init(){
  try{
    // 1) pinta sesión actual
    const sess1 = await getSession();
    if(!sess1?.authenticated){ location.href='/login'; return; }
    paintSession(sess1);

    // 2) pide sync a Stripe para “jalar” el estado final
    statusLine.innerHTML = '<span class="dot2"></span> Confirmando pago…';
    await syncStripe();

    // 3) repinta (y reintenta un poco)
    let tries = 0, done = false;
    while(tries < 10 && !done){
      const sess = await getSession();
      paintSession(sess);
      const st = (sess.user?.subscription?.status || '').toLowerCase();
      if(['active','trialing','past_due'].includes(st)){
        done = true;
        statusLine.innerHTML = '✔ Compra procesada. ¡Tu plan está activo!';
        break;
      }
      if(['incomplete','incomplete_expired','canceled','unpaid'].includes(st)){
        statusLine.innerHTML = '⚠ No pudimos confirmar el pago. Puedes reintentarlo en Planes.';
        break;
      }
      tries++;
      await new Promise(r=>setTimeout(r, 1500));
    }
    if(!done && tries >= 10){
      statusLine.innerHTML = '⏱ Seguimos confirmando con Stripe… Si ya pagaste, actualiza en unos segundos.';
    }
  }catch(e){
    // silencio: mantenemos la página utilizable
  }
})();
