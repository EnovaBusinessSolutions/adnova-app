// public/js/dashboard.js
/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */
function $(id) {
  return document.getElementById(id.replace(/^#/, ''));
}

/* -------------------------------------------------------------------------- */
/*  Init                                                                      */
/* -------------------------------------------------------------------------- */
async function initDashboard() {
  const userId = sessionStorage.getItem('userId');
  const shop   = sessionStorage.getItem('shop');
  if (!userId || !shop) {
    alert('No se encontró la sesión de usuario. Vuelve a iniciar sesión.');
    return;
  }

  /* --- Llamada al backend ------------------------------------------------ */
  let data;
  try {
    const url = `/api/audit/latest?userId=${encodeURIComponent(userId)}&shop=${encodeURIComponent(shop)}`;
    const r   = await fetch(url);
    data      = await r.json();
    console.log('[DASHBOARD DEBUG]', data);
  } catch (err) {
    alert('Error de red al consultar la auditoría');
    return;
  }

  if (!data.ok || !data.audit) {
    alert(data.error || 'No se encontró auditoría');
    return;
  }
  const d = data.audit;

  /* --- KPI principales --------------------------------------------------- */
  $('#totalSales').textContent    = d.salesLast30  ?? '—';
  $('#totalOrders').textContent   = d.ordersLast30 ?? '—';
  $('#avgOrderValue').textContent =
    d.avgOrderValue !== undefined ? `$${d.avgOrderValue.toFixed(2)}` : '—';

  /* --- Embudo (opcional) ------------------------------------------------- */
  if (d.funnelData) {
    $('#funnelAddToCart').textContent = d.funnelData.addToCart  ?? '0';
    $('#funnelCheckout').textContent  = d.funnelData.checkout   ?? '0';
    $('#funnelPurchase').textContent  = d.funnelData.purchase   ?? '0';
  }

  /* --- Top productos y centro de acciones -------------------------------- */
  renderTopProducts(d.topProducts);
  renderActionCenterCritical(d);
}

/* -------------------------------------------------------------------------- */
/*  Render top-products                                                      */
/* -------------------------------------------------------------------------- */
function renderTopProducts(topProducts = []) {
  const list = document.getElementById('topProducts');
  if (!list) return;

  list.innerHTML = topProducts.length
    ? topProducts
        .map(
          p => `
      <li>
        <span>${p.name || p.title || 'Producto'}</span>
        <span class="product-sales">${p.sales || p.qtySold || 0} ventas</span>
      </li>`
        )
        .join('')
    : '<li>No hay datos suficientes aún</li>';
}

/* -------------------------------------------------------------------------- */
/*  Centro de acciones (críticos)                                            */
/* -------------------------------------------------------------------------- */
function renderActionCenterCritical(audit) {
  const target = document.getElementById('actionCenter');
  if (!target) return;

  /* 1. Copia plana de actionCenter */
  let items = Array.isArray(audit.actionCenter) ? [...audit.actionCenter] : [];

  /* 2. Añade hallazgos severity=high de issues.productos */
  if (audit.issues?.productos?.length) {
    audit.issues.productos.forEach(prod => {
      prod.hallazgos
        ?.filter(h => h.severity === 'high')
        .forEach(h =>
          items.push({
            title: `[${prod.nombre}] ${h.title || ''}`,
            description: h.description || '',
            severity: 'high',
            button: 'Ver detalle'
          })
        );
    });
  }

  /* 3. Elimina duplicados (title + description) */
  items = items.filter(
    (v, i, a) =>
      a.findIndex(t => t.title === v.title && t.description === v.description) === i
  );

  /* 4. Render */
  target.innerHTML = items.length
    ? items
        .map(
          act => `
      <div class="action-item ${act.severity}">
        <div class="action-content">
          <h4>${act.title}</h4>
          <p>${act.description}</p>
        </div>
        <button class="btn-action">${act.button || 'Revisar'}</button>
      </div>`
        )
        .join('')
    : '<p>No hay acciones pendientes 🎉</p>';
}

/* -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', initDashboard);
