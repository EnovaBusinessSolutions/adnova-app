/* ---------------- helpers ---------------- */
const $   = sel => document.querySelector(sel);
const $$  = sel => document.querySelectorAll(sel);
const fmt = n  => new Intl.NumberFormat('es-MX').format(n);
const $$m = n  => new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);

function trend(val){
  const cls = val>=0 ? 'up' : 'down';
  const sym = val>=0 ? '▲' : '▼';
  return `<span class="trend ${cls}">${sym} ${Math.abs(val).toFixed(1)} %</span>`;
}

/* ---------------- KPI & resumen ---------------- */
async function loadSummary(){
  const data = await fetch('/api/ga/summary').then(r=>r.json());

  const kpis = [
    {id:'users',        label:'Usuarios',      val:fmt(data.users),       t:trend(data.trUsers)},
    {id:'impr',         label:'Impresiones',   val:fmt(data.impr),        t:trend(data.trImpr)},
    {id:'clicks',       label:'Clics',         val:fmt(data.clicks),      t:trend(data.trClicks)},
    {id:'spend',        label:'Gasto',         val:$$m(data.spend),       t:trend(data.trSpend)},
    {id:'conv',         label:'Conversiones',  val:fmt(data.conv),        t:trend(data.trConv)},
    {id:'revenue',      label:'Ingresos',      val:$$m(data.revenue),     t:trend(data.trRev)},
    {id:'roas',         label:'ROAS',          val:data.roas.toFixed(2)+'×', t:trend(data.trRoas)},
  ];

  $('#kpi-grid').innerHTML = kpis.map(k=>`
    <div class="kpi-card">
      <i class="kpi-icon ph-chart-bar"></i>
      <div>
        <p class="kpi-label">${k.label}</p>
        <p class="kpi-value">${k.val} ${k.t}</p>
      </div>
    </div>`).join('');
}

/* ---------------- Gráficos ---------------- */
let chartTraffic, chartEngage, chartPlat, chartRet, chartSpend;
async function loadCharts(){
  const d = await fetch('/api/ga/charts').then(r=>r.json());

  // Fuentes de tráfico
  if(chartTraffic) chartTraffic.destroy();
  chartTraffic = new Chart($('#chart-traffic'),{
    type:'pie',
    data:{labels:d.traffic.labels,datasets:[{data:d.traffic.values,backgroundColor:d.traffic.colors}]},
    options:{plugins:{legend:{position:'bottom'}}}
  });

  // Engagement rate & CTR
  if(chartEngage) chartEngage.destroy();
  chartEngage = new Chart($('#chart-engagement'),{
    type:'line',
    data:{labels:d.engage.dates,datasets:d.engage.series},
    options:{interaction:{mode:'index',intersect:false}}
  });

  // Tasa conversión por plataforma
  if(chartPlat) chartPlat.destroy();
  chartPlat = new Chart($('#chart-platform-conv'),{
    type:'bar',
    data:{labels:d.platform.labels,datasets:[{data:d.platform.values,backgroundColor:'#4ade80'}]},
    options:{plugins:{legend:{display:false}}}
  });

  // Retención
  if(chartRet) chartRet.destroy();
  chartRet = new Chart($('#chart-retention'),{
    type:'bar',
    data:{labels:d.retention.week, datasets:[{data:d.retention.values,backgroundColor:'#6366f1'}]},
    options:{plugins:{legend:{display:false}}}
  });

  // Gasto vs Ingreso
  if(chartSpend) chartSpend.destroy();
  chartSpend = new Chart($('#chart-spend-revenue'),{
    type:'line',
    data:{labels:d.spendRevenue.dates, datasets:d.spendRevenue.series},
    options:{interaction:{mode:'index',intersect:false}}
  });
}

/* ---------------- Tablas ---------------- */
async function loadTables(){
  const t = await fetch('/api/ga/tables').then(r=>r.json());

  // campañas
  $('#tbl-campaigns tbody').innerHTML = t.campaigns.map(r=>`
    <tr>
      <td>${r.name}</td><td>${r.channel}</td>
      <td>${fmt(r.clicks)}</td><td>${$$m(r.spend)}</td>
      <td><span class="badge ${badgeRoas(r.roas)}">${r.roas.toFixed(1)}×</span></td>
    </tr>`).join('');

  // audiencia
  $('#tbl-audience tbody').innerHTML = t.audience.map(a=>`
    <tr><td>${a.seg}</td><td>${fmt(a.users)}</td>
    <td>${a.conv.toFixed(2)} %</td><td>${$$m(a.rev)}</td></tr>`).join('');

  // creatividades
  $('#tbl-creatives tbody').innerHTML = t.creatives.map(c=>`
    <tr>
      <td>${c.name}</td><td>${c.platform}</td>
      <td>${fmt(c.impr)}</td><td>${c.ctr.toFixed(1)} %</td>
      <td>${fmt(c.conv)}</td><td>${c.qs.toFixed(1)}/10</td>
    </tr>`).join('');

  // budget bars
  $('#budget-bars').innerHTML = t.budget.map(b=>`
    <div class="budget-row">
      <span>${b.campaign}</span>
      <div class="bar">
        <div style="width:${b.usedPct}%;"></div>
      </div>
      <span class="badge ${b.usedPct>90?'danger':b.usedPct>70?'warn':''}">
        ${b.usedPct}% usado
      </span>
    </div>`).join('');
}

/* badge ROAS color */
function badgeRoas(r){
  return r>=8 ? 'success' : r>=5 ? 'warn' : 'danger';
}

/* ---------------- Funnel ---------------- */
async function loadFunnel(){
  const f = await fetch('/api/ga/funnel').then(r=>r.json());
  $('#funnel-grid').innerHTML = f.map((step,i)=>`
    <div class="funnel-card">
      <h3>${step.label}</h3>
      <p class="funnel-val">${fmt(step.value)}</p>
      <p class="drop">Drop: ${step.drop.toFixed(1)} %</p>
    </div>
    ${i<f.length-1?'<i class="ph-caret-right funnel-arrow"></i>':''}
  `).join('');
}

/* ---------------- init ---------------- */
function init(){
  $('#btn-refresh').addEventListener('click',()=>{
    loadSummary();loadCharts();loadTables();loadFunnel();
  });
  loadSummary();loadCharts();loadTables();loadFunnel();
}
document.addEventListener('DOMContentLoaded',init);
