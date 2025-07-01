document.addEventListener("DOMContentLoaded", async () => {
  // Obtén los datos guardados del usuario/shop
  const shop = sessionStorage.getItem('shop');
  const accessToken = sessionStorage.getItem('accessToken');
  const userId = sessionStorage.getItem('userId');

  const btn = document.getElementById('continue-btn-3');
  const progressBar = document.querySelector('.progress-indicator');
  const progressText = document.querySelector('.progress-text');
  const stepNodes = document.querySelectorAll('.analysis-step');
  btn.disabled = true;

  // Definición de los pasos visuales
  const steps = [
    "Conectando con Shopify",
    "Analizando catálogo de productos",
    "Analizando segmentos de clientes",
    "Generando recomendaciones inteligentes"
  ];
  const stepPercents = [0, 25, 55, 80, 100];

  let progress = 0;
  let running = true;
  let currentStep = 0;

  // Actualiza la UI de los pasos
  function updateStepsUI() {
    stepNodes.forEach((node, idx) => {
      if (idx < currentStep) {
        node.classList.remove('active');
        node.classList.add('completed');
        node.querySelector('.analysis-step-icon').textContent = '✓';
      } else if (idx === currentStep) {
        node.classList.add('active');
        node.classList.remove('completed');
        node.querySelector('.analysis-step-icon').textContent = '⟳';
      } else {
        node.classList.remove('active', 'completed');
        node.querySelector('.analysis-step-icon').textContent = '○';
      }
    });
    progressText.textContent = steps[currentStep] || "Finalizando…";
  }

  // Barra animada y pasos animados
  function animateProgress() {
    if (!running) return;
    if (progress < 90) {
      progress += Math.random() * 2 + 1;
      if (progress > 90) progress = 90;
      progressBar.style.width = `${progress}%`;

      // Determina el step actual
      for (let i = stepPercents.length - 1; i >= 0; i--) {
        if (progress >= stepPercents[i]) {
          currentStep = i;
          break;
        }
      }
      updateStepsUI();
      setTimeout(animateProgress, 250);
    }
  }

  // Inicia animaciones visuales
  progressBar.style.width = "0%";
  updateStepsUI();
  animateProgress();

  // ----------- LLAMADA AL BACKEND (Genera la auditoría IA) -----------
  try {
    // Validación mínima
    if (!shop || !accessToken) {
      throw new Error("Faltan datos de sesión. Por favor, reinicia el proceso.");
    }

    // Solicita la generación de auditoría
    const res = await fetch('/api/audit/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, accessToken, userId })
    });

    // Verifica si responde bien el backend
    if (!res.ok) {
      let msg = "Error al generar la auditoría.";
      try {
        const err = await res.json();
        msg = err?.error || msg;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();

    // Finaliza: barra llena, todos los steps completos
    running = false;
    progress = 100;
    progressBar.style.width = "100%";
    currentStep = steps.length - 1;
    updateStepsUI();
    progressText.textContent = "¡Análisis completado!";
    btn.disabled = false;

    // Guarda el resultado (opcional: úsalo para mostrar resumen en el siguiente paso)
    sessionStorage.setItem('auditResult', JSON.stringify(data.resultado || data.result || data));

  } catch (err) {
    running = false;
    progressBar.style.background = "#f55";
    progressText.textContent = err?.message || "Ocurrió un error. Intenta de nuevo.";
    alert(err?.message || 'Ocurrió un error al analizar tu tienda.');
    btn.disabled = false;
  }
});

// Listener para avanzar al step 4 (Onboarding final)
document.getElementById('continue-btn-3')?.addEventListener('click', () => {
  window.location.href = '/onboarding4.html';
});
