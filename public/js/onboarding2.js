// public/js/onboarding2.js

function showEl(el) {
  if (!el) return;
  el.classList.remove('hidden');
  el.removeAttribute('aria-hidden');
  el.style.display = el.classList.contains('content-panel') ? 'flex' : 'block';
  el.style.visibility = 'visible';
  el.style.opacity = '1';
  if (!el.style.position) el.style.position = 'relative';
  el.style.zIndex = '3';
}
function hideEl(el) {
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  el.style.display = 'none';
  el.style.visibility = 'hidden';
  el.style.opacity = '0';
  el.style.zIndex = '';
}

// --- helpers de red -----------------
async function j(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function post(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// --- lógica de decisión --------------
async function maybeGoToSelectionStep() {
  // 1) Traer cuentas de ambos proveedores
  const [mRes, gRes] = await Promise.allSettled([
    j('/api/meta/accounts'),
    j('/api/google/ads/insights/accounts')
  ]);

  const metaAccounts   = mRes.status === 'fulfilled' ? (mRes.value.accounts || mRes.value.ad_accounts || []) : [];
  const googleAccounts = gRes.status === 'fulfilled' ? (gRes.value.accounts || []) : [];

  const metaTotal   = metaAccounts.length;
  const googleTotal = googleAccounts.length;

  const needsMetaSelection   = metaTotal   > 2;
  const needsGoogleSelection = googleTotal > 2;

  // 2) Autoselección si 1 o 2 por proveedor
  const calls = [];

  if (!needsMetaSelection && metaTotal > 0) {
    // Nota: en /api/meta/accounts.id viene formateado como "act_123..."
    const ids = metaAccounts.map(a => a.id);
    calls.push(post('/api/meta/accounts/selection', { accountIds: ids }).catch(() => {}));
    sessionStorage.setItem('metaConnected', '1');
  }

  if (!needsGoogleSelection && googleTotal > 0) {
    const ids = googleAccounts.map(a => a.id);
    calls.push(post('/api/google/ads/insights/accounts/selection', { accountIds: ids }).catch(() => {}));
    sessionStorage.setItem('googleConnected', '1');
  }

  if (calls.length) {
    try { await Promise.all(calls); } catch (_) {}
  }

  // 3) Redirección según necesidad
  if (needsMetaSelection || needsGoogleSelection) {
    window.location.href = '/onboarding-select.html';
  } else {
    window.location.href = '/onboarding3.html';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const $root = document.getElementById('onboarding') || document;

  const s1 = document.getElementById('step1-content');
  const s2 = document.getElementById('step2-content');

  const backBtn2 = document.getElementById('back-btn-2');
  const continueBtn2 = document.getElementById('continue-btn-2');

  // marca el step activo
  $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  $root.querySelector('.step[data-step="2"]')?.classList.add('active');

  showEl(s2);
  hideEl(s1);

  backBtn2?.addEventListener('click', () => {
    window.location.href = '/onboarding.html#step=1';
  });

  continueBtn2?.addEventListener('click', async (e) => {
    e.preventDefault();
    continueBtn2.disabled = true;
    continueBtn2.textContent = 'Continuando…';
    try {
      await maybeGoToSelectionStep();
    } catch (err) {
      console.error('continue error', err);
      // si algo truena, avanza por el camino normal
      window.location.href = '/onboarding3.html';
    }
  });

  // control por hash (navegación directa)
  if (location.hash && /step=1/.test(location.hash)) {
    $root.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    $root.querySelector('.step[data-step="1"]')?.classList.add('active');
    showEl(s1); hideEl(s2);
  } else {
    if (location.hash !== '#step=2') location.hash = '#step=2';
  }
});
