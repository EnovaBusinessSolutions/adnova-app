/* ========= manejo de pestañas ========= */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelector('.tab-btn.active')?.classList.remove('active');
    btn.classList.add('active');
    const paneId = 'tab-' + btn.dataset.tab;
    document.querySelectorAll('.tab-pane').forEach(pane =>
      pane.classList.toggle('active', pane.id === paneId)
    );
  });
});

/* ========= carga inicial y refresco ========= */
document.getElementById('refresh-ga').addEventListener('click', cargarGA);
cargarGA();

async function cargarGA() {
  try {
    /* ---- KPIs ---- */
    const resumen = await fetch('/api/ga/summary?range=30d').then(r => r.json());
    set('kpi-sessions', resumen.sessions);
    set('kpi-revenue',  dinero(resumen.revenue));
    set('kpi-cr',       porcentaje(resumen.cr));
    set('kpi-bounce',   porcentaje(resumen.bounce));

    /* ---- issues por bloque ---- */
    const issues = await fetch('/api/ga/issues').then(r => r.json());
    pintar('health',      issues.health);
    pintar('acquisition', issues.acquisition);
    pintar('behaviour',   issues.behaviour);
    pintar('funnel',      issues.funnel);
    pintar('retention',   issues.retention);
    pintar('coverage',    issues.coverage);
  } catch (err) {
    console.error('Error GA:', err);
    alert('No se pudieron cargar los datos de Google Analytics.');
  }
}

/* ========= helpers ========= */
function set(id, txt)          { document.getElementById(id).textContent = txt ?? '—'; }
const dinero     = v => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v);
const porcentaje = v => (v*100).toFixed(1) + ' %';

function pintar(bloque, lista = []) {
  const cont = document.getElementById('tab-' + bloque);
  if (!lista.length) {
    cont.innerHTML = '<p class="text-muted">Sin problemas detectados ✔️</p>';
    return;
  }
  cont.innerHTML = lista.map(i => `
    <div class="card issue-card">
      <h3>${i.title}</h3>
      <p>${i.description}</p>
      <p class="text-muted">Impacto estimado: <strong>${i.impact}</strong></p>
      <button class="btn-fix" data-id="${i.id}">Corregir</button>
    </div>
  `).join('');
  cont.querySelectorAll('.btn-fix').forEach(btn =>
    btn.addEventListener('click', () => corregir(btn.dataset.id))
  );
}

async function corregir(id) {
  if (!confirm('¿Aplicar corrección automática?')) return;
  try {
    const res = await fetch('/api/ga/fix/' + id, { method: 'POST' }).then(r => r.json());
    alert(res.message || 'Solicitud enviada.');
  } catch {
    alert('Error al aplicar la corrección.');
  }
}
