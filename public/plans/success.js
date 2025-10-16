(() => {
  const $ = (id) => document.getElementById(id);

  const badge   = $('statusBadge');   // “Procesando pago…”
  const sessEl  = $('sessInfo');      // Muestra email o “–”
  const planEl  = $('planInfo');      // Muestra plan actual
  const subEl   = $('subInfo');       // Muestra estado de suscripción

  const setText = (el, txt) => { if (el) el.textContent = txt; };

  async function getMe() {
    try {
      const r = await fetch('/api/me', { credentials: 'include' });
      if (!r.ok) return { ok:false, status:r.status };
      const j = await r.json();
      return { ok:true, data:j };
    } catch (e) {
      return { ok:false, error:e?.message || 'fetch error' };
    }
  }

  async function tick() {
    const res = await getMe();

    if (!res.ok) {
      setText(sessEl, '—');
      setText(planEl, '—');
      setText(subEl,  '—');
      if (badge) badge.textContent = 'Error consultando el estado. Reintentando…';
      return false;
    }

    const u = res.data || {};
    setText(sessEl, (u.email || '—'));

    // plan y sub llegan del webhook; podemos verlos ya actualizados
    const planName = (u.plan || 'gratis').toLowerCase();
    setText(planEl, planName);

    const sub = u.subscription || {};
    const status = sub.status || '—';
    setText(subEl, status);

    if (badge) {
      if (status === 'active' || status === 'trialing') {
        badge.textContent = '¡Listo! Tu plan está activo.';
      } else {
        badge.textContent = 'Procesando pago…';
      }
    }
    return (status === 'active' || status === 'trialing');
  }

  // Reintenta varios ciclos (backoff suave) hasta ver la sub activa
  let attempts = 0;
  const maxAttempts = 20;

  async function loop() {
    const done = await tick();
    attempts++;
    if (done || attempts >= maxAttempts) return;
    const delay = Math.min(1500 + attempts * 250, 4000);
    setTimeout(loop, delay);
  }

  document.addEventListener('DOMContentLoaded', loop);
})();
