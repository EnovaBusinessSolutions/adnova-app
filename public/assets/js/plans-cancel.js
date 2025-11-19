const $ = (s)=>document.querySelector(s);
const emailEl = $('#email');
const chipPlan = $('#chip-plan');
const chipSub  = $('#chip-sub');
const hint     = $('#hint');

function setChip(el, val, state){
  el.querySelector('.val').textContent = val ?? '—';
  el.classList.remove('ok','warn','err');
  if (state) el.classList.add(state);
}

async function getSession(){
  const r = await fetch('/api/session',{ credentials:'include' });
  if (!r.ok) throw new Error('No session');
  return r.json();
}

(async function init(){
  try{
    const sess = await getSession();
    if(!sess?.authenticated){ location.href = '/login'; return; }
    const u = sess.user || {};
    emailEl.textContent = u.email || '—';

    const plan = (u.plan || '').toLowerCase() || 'gratis';
    setChip(chipPlan, plan, plan !== 'gratis' ? 'ok' : '');

    const st = (u.subscription?.status || '—').toLowerCase();
    let state = '';
    if(['active','trialing','past_due'].includes(st)) state = 'ok';
    else if(['incomplete','incomplete_expired'].includes(st)) state = 'warn';
    else if(['canceled','unpaid'].includes(st)) state = 'err';
    setChip(chipSub, st || '—', state);

    hint.style.display = ['incomplete','incomplete_expired'].includes(st) ? 'block' : 'none';
  }catch(_){
    // si no hay sesión, dejamos CTAs visibles
  }
})();
