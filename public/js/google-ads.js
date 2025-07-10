/* ---- pestañas ---- */
document.querySelectorAll('.tab-btn').forEach(b=>{
  b.addEventListener('click',()=>{
    document.querySelector('.tab-btn.active')?.classList.remove('active');
    b.classList.add('active');
    const paneId='tab-'+b.dataset.tab;
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active',p.id===paneId));
  });
});

/* ---- refresco ---- */
document.getElementById('refresh-ads').addEventListener('click',cargarAds);
cargarAds();

async function cargarAds(){
  try{
    // KPIs
    const kpi=await fetch('/api/ads/summary?range=30d').then(r=>r.json());
    set('kpi-spend',   money(kpi.spend));
    set('kpi-revenue', money(kpi.revenue));
    set('kpi-roas',    (kpi.roas||0).toFixed(2)+'×');
    set('kpi-cac',     money(kpi.cac));
    set('kpi-qs',      (kpi.qs||0).toFixed(1));

    // Issues por bloque
    const blocks=await fetch('/api/ads/issues').then(r=>r.json());
    pintar('performance',blocks.performance);
    pintar('waste',      blocks.waste);
    pintar('structure',  blocks.structure);
    pintar('tracking',   blocks.tracking);
    pintar('shopping',   blocks.shopping);
    pintar('audience',   blocks.audience);
  }catch(e){
    console.error('Ads error',e);
    alert('No se pudo cargar Google Ads.');
  }
}

/* ---- helpers ---- */
function set(id,val){document.getElementById(id).textContent=val??'—';}
const money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v);

function pintar(bloque,list=[]){
  const el=document.getElementById('tab-'+bloque);
  if(!list.length){el.innerHTML='<p class="text-muted">Sin problemas detectados ✔️</p>';return;}
  el.innerHTML=list.map(i=>`
    <div class="card issue-card">
      <h3>${i.title}</h3>
      <p>${i.description}</p>
      <p class="text-muted">Impacto estimado: <strong>${i.impact}</strong></p>
      <button class="btn-fix" data-id="${i.id}">${i.cta||'Corregir'}</button>
    </div>`).join('');
  el.querySelectorAll('.btn-fix').forEach(btn=>{
    btn.addEventListener('click',()=>aplicarFix(btn.dataset.id));
  });
}

async function aplicarFix(id){
  if(!confirm('¿Aplicar corrección automática?'))return;
  try{
    const r=await fetch('/api/ads/fix/'+id,{method:'POST'}).then(x=>x.json());
    alert(r.message||'Solicitado');
  }catch{alert('Error al aplicar.');}
}
