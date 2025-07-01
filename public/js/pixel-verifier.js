// js/pixelVerifier.js

document.addEventListener('DOMContentLoaded', () => {
  renderPixelEvents();
  renderImplementationQuality();
});

// 1. Renderizar la tabla de eventos de píxel
async function renderPixelEvents() {
  const tbody = document.getElementById('pixelEventsBody');
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Cargando eventos...</td></tr>`;

  // Aquí conectas a tu backend, pero aquí simulo la respuesta:
  // Ejemplo: const res = await fetch('/api/pixels'); const events = await res.json();
  const events = [
    { name: "PageView", platform: "Facebook", required: true, status: "detected", canFix: false },
    { name: "ViewContent", platform: "Facebook", required: true, status: "detected", canFix: false },
    { name: "AddToCart", platform: "Facebook", required: true, status: "detected", canFix: false },
    { name: "InitiateCheckout", platform: "Facebook", required: true, status: "missing", canFix: true },
    { name: "Purchase", platform: "Facebook", required: true, status: "missing", canFix: true },
    { name: "page_view", platform: "Google", required: true, status: "detected", canFix: false },
    { name: "view_item", platform: "Google", required: true, status: "detected", canFix: false },
    { name: "add_to_cart", platform: "Google", required: true, status: "detected", canFix: false },
    { name: "begin_checkout", platform: "Google", required: true, status: "missing", canFix: true },
    { name: "purchase", platform: "Google", required: true, status: "missing", canFix: true }
  ];

  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No se encontraron eventos.</td></tr>`;
    return;
  }

  tbody.innerHTML = events.map(ev => `
    <tr>
      <td class="font-medium">${ev.name}</td>
      <td>${ev.platform}</td>
      <td>${ev.required ? "Yes" : "No"}</td>
      <td>
        ${
          ev.status === "detected"
            ? `<span class="status-badge status-badge-success">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Detected
              </span>`
            : `<span class="status-badge status-badge-error">Missing</span>`
        }
      </td>
      <td class="text-right">
        ${ev.canFix ? `<button class="btn-inject" onclick="alert('Auto-fix for ${ev.name}')">Inject Fix</button>` : ""}
      </td>
    </tr>
  `).join('');
}

// 2. Renderizar calidad de implementación (cards)
function renderImplementationQuality() {
  const container = document.getElementById('implementationQuality');
  // Borra el contenido hardcodeado si lo vas a hacer 100% dinámico:
  // container.innerHTML = "";

  // Puedes traer estos datos del backend o definirlos así:
  const qualityChecks = [
    {
      severity: "high",
      title: "Parámetros de Valor Faltantes",
      desc: "A tus eventos de Compra de Facebook les faltan parámetros de valor, lo que resulta en cálculos inexactos de ROAS en tus informes de anuncios.",
      cta: "Corregir Implementación"
    },
    {
      severity: "medium",
      title: "Eventos Duplicados",
      desc: "Los eventos de Google Analytics se están disparando dos veces en algunas páginas, lo que potencialmente afecta la precisión de tus informes de conversión.",
      cta: "Corregir Implementación"
    },
    {
      severity: "low",
      title: "Ecommerce Mejorado No Completamente Utilizado",
      desc: "No estás aprovechando al máximo el seguimiento de Ecommerce Mejorado en Google Analytics, perdiendo información valiosa sobre el comportamiento de compra.",
      cta: "Mejorar Implementación"
    }
  ];

  // Si lo quieres todo dinámico:
  // container.innerHTML = qualityChecks.map(q => `
  //   <div class="implementation-card">
  //     <div class="flex items-start gap-3">
  //       <div class="severity-indicator severity-${q.severity} mt-1.5"></div>
  //       <div>
  //         <h3 class="font-medium">${q.title}</h3>
  //         <p class="text-sm text-muted-foreground">${q.desc}</p>
  //         <div class="mt-2">
  //           <button class="btn-gradient">${q.cta}</button>
  //         </div>
  //       </div>
  //     </div>
  //   </div>
  // `).join('');
}

// Si necesitas conectar "Fix All Missing Events":
document.getElementById('fixAllBtn').onclick = function() {
  alert('Esta función será implementada próximamente 🚀');
};
