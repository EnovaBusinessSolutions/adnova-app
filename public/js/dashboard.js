// public/js/dashboard.js

async function initDashboard() {
  // 1. Trae la auditoría más reciente
  const r = await apiFetch('/audits/latest');
  const d = await r.json();

  // Si no hay auditoría, sal
  if (!d || !d._id) return;

  // KPIs principales
  $('#totalSales').textContent      = d.salesLast30 !== undefined ? `${d.salesLast30.toFixed(0)}` : '—';
  $('#totalOrders').textContent     = d.ordersLast30 !== undefined ? `${d.ordersLast30}` : '—';
  $('#avgOrderValue').textContent   = d.avgOrderValue !== undefined ? `$${d.avgOrderValue.toFixed(2)}` : '—';

  // Embudo de conversión (aquí debes adaptar los nombres según los datos de tu auditoría)
  if (d.funnelData) {
    $('#funnelAddToCart').textContent = d.funnelData.addToCart || '0';
    $('#funnelCheckout').textContent  = d.funnelData.checkout || '0';
    $('#funnelPurchase').textContent  = d.funnelData.purchase || '0';
    // Si quieres modificar el ancho de la barra:
    $('#funnelAddToCartBar').style.width = `${d.funnelData.addToCart || 0}%`;
    $('#funnelCheckoutBar').style.width  = `${d.funnelData.checkout || 0}%`;
    $('#funnelPurchaseBar').style.width  = `${d.funnelData.purchase || 0}%`;
  }

  // Top productos
  renderTopProducts(d.topProducts);

  // Centro de acciones
  renderActionCenter(d.actionCenter);
}

// Renderiza la tabla/lista de productos más vendidos
function renderTopProducts(topProducts = []) {
  const list = document.getElementById('topProductsList');
  if (!list) return;
  list.innerHTML = topProducts.length
    ? topProducts.map(p => `
        <li>
          <span>${p.name}</span>
          <span class="product-sales">${p.sales} ventas</span>
        </li>
      `).join('')
    : '<li>No hay datos suficientes aún</li>';
}

// Renderiza las acciones críticas detectadas
function renderActionCenter(items = []) {
  const actionDiv = document.getElementById('actionCenterItems');
  if (!actionDiv) return;
  actionDiv.innerHTML = items.length
    ? items.map(act => `
        <div class="action-item ${act.severity}">
          <div class="action-content">
            <h4>${act.title}</h4>
            <p>${act.description}</p>
          </div>
          <button class="btn-action">${act.button || 'Revisar'}</button>
        </div>
      `).join('')
    : '<p>No hay acciones pendientes 🎉</p>';
}

// Utilidad para seleccionar por id fácil (tipo jQuery)
function $(id) { return document.getElementById(id.replace(/^#/, '')); }

document.addEventListener('DOMContentLoaded', initDashboard);
