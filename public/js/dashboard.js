// public/js/dashboard.js

// Utilidad para seleccionar por id fácil (tipo jQuery)
function $(id) { return document.getElementById(id.replace(/^#/, '')); }

async function initDashboard() {
  // 1. Trae los datos necesarios del usuario
  const userId = sessionStorage.getItem('userId');
  const shop = sessionStorage.getItem('shop');
  if (!userId || !shop) {
    alert("No se encontró la sesión de usuario. Vuelve a iniciar sesión.");
    return;
  }

  // 2. Llama al backend correctamente
  let data;
  try {
    const r = await fetch(`/api/audit/latest?userId=${encodeURIComponent(userId)}&shop=${encodeURIComponent(shop)}`);
    data = await r.json();
    console.log('[DASHBOARD DEBUG]', data); // <-- Útil para depuración, puedes quitarlo si todo va bien
  } catch (err) {
    alert('Error de red al consultar la auditoría');
    return;
  }

  // 3. Maneja errores o falta de datos
  if (!data.ok || !data.audit) {
    alert(data.error || 'No se encontró auditoría');
    return;
  }
  const d = data.audit;

  // 4. KPIs principales
  $('#totalSales').textContent      = d.salesLast30 !== undefined ? `${d.salesLast30.toFixed(0)}` : '—';
  $('#totalOrders').textContent     = d.ordersLast30 !== undefined ? `${d.ordersLast30}` : '—';
  $('#avgOrderValue').textContent   = d.avgOrderValue !== undefined ? `$${d.avgOrderValue.toFixed(2)}` : '—';

  // 5. Embudo de conversión (adapta si tu modelo lo guarda)
  if (d.funnelData) {
    $('#funnelAddToCart').textContent = d.funnelData.addToCart || '0';
    $('#funnelCheckout').textContent  = d.funnelData.checkout || '0';
    $('#funnelPurchase').textContent  = d.funnelData.purchase || '0';
    // Aquí puedes ajustar el width de la barra si tienes visualizaciones
  }

  // 6. Top productos
  renderTopProducts(d.topProducts);

  // 7. Centro de acciones
  renderActionCenter(d.actionCenter);
}

// Renderiza la tabla/lista de productos más vendidos
function renderTopProducts(topProducts = []) {
  const list = document.getElementById('topProducts');
  if (!list) return;
  list.innerHTML = topProducts && topProducts.length
    ? topProducts.map(p => `
        <li>
          <span>${p.name || p.title || 'Producto'}</span>
          <span class="product-sales">${p.sales || p.qtySold || 0} ventas</span>
        </li>
      `).join('')
    : '<li>No hay datos suficientes aún</li>';
}

// Renderiza las acciones críticas detectadas
function renderActionCenter(items = []) {
  const actionDiv = document.getElementById('actionCenter');
  if (!actionDiv) return;
  actionDiv.innerHTML = items && items.length
    ? items.map(act => `
        <div class="action-item ${act.severity || ''}">
          <div class="action-content">
            <h4>${act.title || ''}</h4>
            <p>${act.description || ''}</p>
          </div>
          <button class="btn-action">${act.button || 'Revisar'}</button>
        </div>
      `).join('')
    : '<p>No hay acciones pendientes 🎉</p>';
}

document.addEventListener('DOMContentLoaded', initDashboard);
