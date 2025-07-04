/* -------------------------------------------------------------------------- */
/*  utils                                                                     */
/* -------------------------------------------------------------------------- */
function $(id) {
  return document.getElementById(id.replace(/^#/, ''));
}

/* -------------------------------------------------------------------------- */
/*  Init audit page                                                           */
/* -------------------------------------------------------------------------- */
async function initAudit() {
  const userId = sessionStorage.getItem('userId');
  const shop   = sessionStorage.getItem('shop');
  const cats   = ['ux', 'seo', 'performance', 'media'];

  // Mensaje helper
  const paintEmpty = msg =>
    cats.forEach(c => ($(`audit-${c}`).innerHTML = `<div class="empty-state">${msg}</div>`));

  if (!userId || !shop) {
    paintEmpty('Faltan datos de sesión. Por favor, vuelve a iniciar sesión.');
    return;
  }

  /* --- Llamada API ------------------------------------------------------- */
  let audit;
  try {
    const qs   = new URLSearchParams({ userId, shop });
    const resp = await fetch(`/api/audit/latest?${qs}`);
    const data = await resp.json();
    console.log('[AUDIT DEBUG]', data);
    audit = data.ok ? data.audit : null;
  } catch {
    paintEmpty('No se pudo cargar la auditoría.');
    return;
  }

  if (!audit) {
    paintEmpty('No se encontró auditoría.');
    return;
  }

  /* ---------------------------------------------------------------------- */
  /*  Normalización de hallazgos                                            */
  /* ---------------------------------------------------------------------- */
  const issuesByCat = { ux: [], seo: [], performance: [], media: [] };

  // Helper para mapear área → categoría
  const areaToCat = area => {
    const a = (area || '').toLowerCase();
    if (a.includes('seo'))            return 'seo';
    if (a.includes('performance') ||
        a.includes('rendimiento'))    return 'performance';
    if (a.includes('media') ||
        a.includes('imagen') ||
        a.includes('video'))          return 'media';
    return 'ux'; // por defecto (incluye UX, nombre, descripción…)
  };

  /* ----- Caso nuevo formato (issues.productos) -------------------------- */
  if (audit.issues?.productos?.length) {
    audit.issues.productos.forEach(prod => {
      (prod.hallazgos || []).forEach(h => {
        const cat = areaToCat(h.area);
        issuesByCat[cat].push({ ...h, productName: prod.nombre });
      });
    });
  }

  /* ----- Caso legacy (ux/seo/performance/media directos) ---------------- */
  ['ux', 'seo', 'performance', 'media'].forEach(cat => {
    if (audit.issues?.[cat]?.length) {
      issuesByCat[cat].push(...audit.issues[cat]);
    }
  });

  /* ---------------------------------------------------------------------- */
  /*  Render                                                                */
  /* ---------------------------------------------------------------------- */
  cats.forEach(cat => renderAuditCategory(cat, issuesByCat[cat]));
}

/* -------------------------------------------------------------------------- */
/*  Render helpers                                                            */
/* -------------------------------------------------------------------------- */
function renderAuditCategory(cat, issues = []) {
  const container = $(`audit-${cat}`);
  if (!container) return;

  container.innerHTML = issues.length
    ? issues.map(auditCard).join('')
    : '<div class="empty-state">No hay hallazgos en esta categoría aún.</div>';
}

function auditCard(issue) {
  return `
  <div class="audit-item">
    <div class="audit-item-header">
      <div class="flex items-center gap-3">
        <div class="severity-indicator severity-${issue.severity || 'medium'}"></div>
        <h3 class="font-medium">${issue.title || 'Hallazgo'}</h3>
      </div>
      ${
        issue.productName
          ? `<div class="product-tag">Producto: <b>${issue.productName}</b></div>`
          : ''
      }
    </div>

    <div class="audit-item-details">
      <p class="text-sm mb-4">${issue.description || ''}</p>

      ${
        issue.screenshot
          ? `
        <div class="mb-4">
          <p class="text-xs text-muted-foreground mb-2">Screenshot</p>
          <div class="screenshot-container">
            <img src="${issue.screenshot}" alt="Evidencia" />
          </div>
        </div>`
          : ''
      }

      ${
        issue.recommendation
          ? `
        <div>
          <p class="text-xs text-muted-foreground mb-2">Solución recomendada</p>
          <p class="text-sm">${issue.recommendation}</p>
        </div>`
          : ''
      }

      <div class="flex gap-2 mt-4">
        <button class="button-fix">Corregir</button>
        <button class="button-ignore">Ignorar</button>
      </div>
    </div>
  </div>`;
}

/* -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', initAudit);
