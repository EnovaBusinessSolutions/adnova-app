document.addEventListener("DOMContentLoaded", async () => {
  const shop = sessionStorage.getItem('shop');
  const accessToken = sessionStorage.getItem('accessToken');
  const userId = sessionStorage.getItem('userId');

  const btn = document.getElementById('continue-btn-3');
  const progressBar = document.querySelector('.progress-indicator');
  const progressText = document.querySelector('.progress-text');
  const stepNodes = document.querySelectorAll('.analysis-step');
  btn.disabled = true;


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


  function animateProgress() {
    if (!running) return;
    if (progress < 90) {
      progress += Math.random() * 2 + 1;
      if (progress > 90) progress = 90;
      progressBar.style.width = `${progress}%`;

    
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


  progressBar.style.width = "0%";
  updateStepsUI();
  animateProgress();

  
  try {
    
    if (!shop || !accessToken) {
      throw new Error("Faltan datos de sesión. Por favor, reinicia el proceso.");
    }

  
    const res = await fetch('/api/audit/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, accessToken, userId })
    });

  
    if (!res.ok) {
      let msg = "Error al generar la auditoría.";
      try {
        const err = await res.json();
        msg = err?.error || msg;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();

    
    running = false;
    progress = 100;
    progressBar.style.width = "100%";
    currentStep = steps.length;   
    updateStepsUI();
    progressText.textContent = "¡Análisis completado!";
    btn.disabled = false;

    
    sessionStorage.setItem('auditResult', JSON.stringify(data.resultado || data.result || data));

  } catch (err) {
    running = false;
    progressBar.style.background = "#f55";
    progressText.textContent = err?.message || "Ocurrió un error. Intenta de nuevo.";
    alert(err?.message || 'Ocurrió un error al analizar tu tienda.');
    btn.disabled = false;
  }
});


document.getElementById('continue-btn-3')?.addEventListener('click', () => {
  window.location.href = '/onboarding4.html';
});
