// js/audit.js

// Utilidad para seleccionar por ID rápido
function $(id) { return document.getElementById(id.replace(/^#/, '')); }

async function initAudit() {
  // Trae la última auditoría del backend (ajusta la ruta si usas prefijo)
  const r = await apiFetch('/audits/latest');
  const audit = await r.json();

  // Si no hay auditoría, muestra mensaje
  if (!audit || !audit.issues) {
    ['ux', 'seo', 'performance', 'media'].forEach(cat => {
      $(`audit-${cat}`).innerHTML = `<div class="empty-state">No hay hallazgos en esta categoría aún.</div>`;
    });
    return;
  }

  // Renderiza cada sección
  renderAuditCategory('ux', audit.issues.ux);
  renderAuditCategory('seo', audit.issues.seo);
  renderAuditCategory('performance', audit.issues.performance);
  renderAuditCategory('media', audit.issues.media);
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

// Template de cada tarjeta de hallazgo
function auditCard(issue) {
  return `
    <div class="audit-item">
      <div class="audit-item-header">
        <div class="flex items-center gap-3">
          <div class="severity-indicator severity-${issue.severity || 'medium'}"></div>
          <h3 class="font-medium">${issue.title || 'Hallazgo'}</h3>
        </div>
        <!-- Si quieres botón expandible, agrégalo aquí -->
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
            <p class="text-xs text-muted-foreground mb-2">Recommended Solution</p>
            <p class="text-sm">${issue.recommendation}</p>
          </div>` : ''}
        <div class="flex gap-2 mt-4">
          <button class="button-fix">Fix Issue</button>
          <button class="button-ignore">Ignore</button>
        </div>
      </div>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', initAudit);
