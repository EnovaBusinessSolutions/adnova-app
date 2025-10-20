(async function () {
  const metaBlock   = document.getElementById('meta-block');
  const metaList    = document.getElementById('meta-list');
  const googleBlock = document.getElementById('google-block');
  const googleList  = document.getElementById('google-list');
  const saveBtn     = document.getElementById('saveBtn');

  const j = async (url, opts={}) => {
    const r = await fetch(url, { credentials: 'include', ...opts });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  const [meta, google] = await Promise.allSettled([
    j('/api/meta/accounts'),
    j('/api/google/ads/insights/accounts')
  ]);

  const metaAccounts   = meta.status==='fulfilled'   ? (meta.value.accounts || []) : [];
  const googleAccounts = google.status==='fulfilled' ? (google.value.accounts || []) : [];

  const needsMeta   = metaAccounts.length > 2;
  const needsGoogle = googleAccounts.length > 2;

  // Si ninguno necesita selección, regresa al siguiente paso normal
  if (!needsMeta && !needsGoogle) {
    // autoselección ya se hace en onboarding2.js (ver paso 5)
    window.location.href = '/onboarding3.html';
    return;
  }

  const state = { meta: new Set(), google: new Set() };

  const draw = (listEl, accounts, set) => {
    listEl.innerHTML = accounts.map(a => `
      <label class="row">
        <input type="checkbox" data-id="${a.id}" />
        <span>${a.name || a.id}</span>
      </label>
    `).join('');
    listEl.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb && cb.matches('input[type="checkbox"]')) {
        const id = cb.dataset.id;
        if (cb.checked) set.add(id); else set.delete(id);
        validate();
      }
    });
  };

  if (needsMeta) {
    metaBlock.classList.remove('hidden');
    draw(metaList, metaAccounts, state.meta);
  }
  if (needsGoogle) {
    googleBlock.classList.remove('hidden');
    draw(googleList, googleAccounts, state.google);
  }

  function validate() {
    const okMeta   = needsMeta   ? state.meta.size   > 0 : true;
    const okGoogle = needsGoogle ? state.google.size > 0 : true;
    saveBtn.disabled = !(okMeta && okGoogle);
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const calls = [];
      if (needsMeta) {
        calls.push(j('/api/meta/accounts/selection', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ accountIds: Array.from(state.meta) })
        }));
      }
      if (needsGoogle) {
        calls.push(j('/api/google/ads/insights/accounts/selection', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ accountIds: Array.from(state.google) })
        }));
      }
      await Promise.all(calls);

      // marca conectados en sessionStorage para pintar chips verdes al volver
      if (needsMeta)   sessionStorage.setItem('metaConnected', '1');
      if (needsGoogle) sessionStorage.setItem('googleConnected', '1');

      window.location.href = '/onboarding3.html';
    } catch (e) {
      console.error(e);
      alert('No pudimos guardar tu selección. Inténtalo de nuevo.');
      saveBtn.disabled = false;
    }
  });

  validate();
})();
