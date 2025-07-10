/* ========= pestañas ========= */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelector('.tab-btn.active')?.classList.remove('active');
    btn.classList.add('active');
    const tabId = 'tab-' + btn.dataset.tab;
    document.querySelectorAll('.tab-pane').forEach(pane =>
      pane.classList.toggle('active', pane.id === tabId)
    );
  });
});

/* ========= carga de datos desde tu API ========= */
(async function loadGA() {
  try {
    // KPIs
    const summary = await fetch('/api/ga/summary?range=30d').then(r => r.json());
    setText('kpi-sessions', summary.sessions);
    setText('kpi-revenue',  cur(summary.revenue));
    setText('kpi-cr',       pct(summary.cr));
    setText('kpi-bounce',   pct(summary.bounce));

    // Issues agrupados en 6 bloques
    const issues = await fetch('/api/ga/issues').then(r => r.json());
    render('health',      issues.health);
    render('acquisition', issues.acquisition);
    render('behaviour',   issues.behaviour);
    render('funnel',      issues.funnel);
    render('retention',   issues.retention);
    render('coverage',    issues.coverage);
  } catch (err) {
    console.error('GA fetch error', err);
  }
})();

/* ========= helpers ========= */
function setText(id, value) {
  document.getElementById(id).textContent = value ?? '—';
}
const cur = v => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v);
const pct = v => (v * 100).toFixed(1) + ' %';

/* pinta lista de issues */
function render(key, list = []) {
  const el = document.getElementById('tab-' + key);
  if (!list.length) {
    el.innerHTML = '<p class="text-muted">Sin problemas detectados ✔️</p>';
    return;
  }
  el.innerHTML = list.map(i => `
    <div class="card issue-card">
      <h3>${i.title}</h3>
      <p>${i.description}</p>
      <p class="text-muted">Impacto estimado: <strong>${i.impact}</strong></p>
      <button class="btn-fix" data-id="${i.id}">Corregir</button>
    </div>
  `).join('');
  el.querySelectorAll('.btn-fix').forEach(btn =>
    btn.addEventListener('click', () => applyFix(btn.dataset.id))
  );
}

/* llamada placeholder para corrección */
async function applyFix(id) {
  if (!confirm('¿Aplicar corrección automática?')) return;
  try {
    const res = await fetch('/api/ga/fix/' + id, { method: 'POST' }).then(r => r.json());
    alert(res.message || 'Solicitado');
  } catch {
    alert('Error al aplicar');
  }
}
