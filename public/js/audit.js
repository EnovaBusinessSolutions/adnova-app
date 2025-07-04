// js/audit.js

function $(id) { return document.getElementById(id.replace(/^#/, '')); }

async function initAudit() {
  const userId = sessionStorage.getItem('userId');
  const shop = sessionStorage.getItem('shop');
  if (!userId || !shop) {
    ['ux', 'seo', 'performance', 'media'].forEach(cat => {
      $(`audit-${cat}`).innerHTML = `<div class="empty-state">Faltan datos de sesión. Por favor, vuelve a iniciar sesión.</div>`;
    });
    return;
  }

  let audit = null;
  try {
    const params = new URLSearchParams({ userId, shop });
    const r = await fetch(`/api/audit/latest?${params.toString()}`);
    const data = await r.json();
    console.log('[AUDIT DEBUG]', data);
    if (data.ok && data.audit) audit = data.audit;
  } catch (e) {
    ['ux', 'seo', 'performance', 'media'].forEach(cat => {
      $(`audit-${cat}`).innerHTML = `<div class="empty-state">No se pudo cargar la auditoría.</div>`;
    });
    return;
  }

  if (!audit || !audit.issues || !audit.issues.productos) {
    ['ux', 'seo', 'performance', 'media'].forEach(cat => {
      $(`audit-${cat}`).innerHTML = `<div class="empty-state">No hay hallazgos en esta categoría aún.</div>`;
    });
    return;
  }

  // Categorización robusta
  const issuesByCat = { ux: [], seo: [], performance: [], media: [] };
  const areaToCat = area => {
    const a = (area || '').toLowerCase();
    if (a.includes('seo')) return 'seo';
    if (a.includes('rendimiento') || a.includes('performance')) return 'performance';
    if (a.includes('media') || a.includes('imagen') || a.includes('video')) return 'media';
    if (a.includes('ux') || a.includes('nombre') || a.includes('descripción')) return 'ux';
    return 'ux';
  };

  for (const prod of audit.issues.productos) {
    if (Array.isArray(prod.hallazgos)) {
      for (const issue of prod.hallazgos) {
        const cat = areaToCat(issue.area);
        if (!issuesByCat[cat]) issuesByCat[cat] = [];
        issuesByCat[cat].push({ ...issue, productName: prod.nombre });
      }
    }
  }

  // Renderiza cada sección
  ['ux', 'seo', 'performance', 'media'].forEach(cat => {
    renderAuditCategory(cat, issuesByCat[cat]);
  });
}

function renderAuditCategory(category, issues = []) {
  const container = $(`audit-${category}`);
  if (!container) return;
  if (!issues || !issues.length) {
    container.innerHTML = `<div class="empty-state">No hay hallazgos en esta categoría aún.</div>`;
    return;
  }
  container.innerHTML = issues.map(issue => auditCard(issue)).join('');
}

function auditCard(issue) {
  return `
    <div class="audit-item">
      <div class="audit-item-header">
        <div class="flex items-center gap-3">
          <div class="severity-indicator severity-${issue.severity || 'medium'}"></div>
          <h3 class="font-medium">${issue.title || 'Hallazgo'}</h3>
        </div>
        ${issue.productName ? `<div class="product-tag">Producto: <b>${issue.productName}</b></div>` : ''}
      </div>
      <div class="audit-item-details">
        <p class="text-sm mb-4">${issue.description || ''}</p>
        ${issue.screenshot ? `
          <div class="mb-4">
            <p class="text-xs text-muted-foreground mb-2">Screenshot</p>
            <div class="screenshot-container">
              <img src="${issue.screenshot}" alt="Evidencia" />
            </div>
          </div>` : ''}
        ${issue.recommendation ? `
          <div>
            <p class="text-xs text-muted-foreground mb-2">Solución recomendada</p>
            <p class="text-sm">${issue.recommendation}</p>
          </div>` : ''}
        <div class="flex gap-2 mt-4">
          <button class="button-fix">Corregir</button>
          <button class="button-ignore">Ignorar</button>
        </div>
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', initAudit);
