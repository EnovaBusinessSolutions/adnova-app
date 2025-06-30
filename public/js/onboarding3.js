document.addEventListener("DOMContentLoaded", async () => {
  const shop = sessionStorage.getItem('shop');
  const accessToken = sessionStorage.getItem('accessToken');
  const btn = document.getElementById('continue-btn-3');
  const progressBar = document.querySelector('.progress-indicator');
  const progressText = document.querySelector('.progress-text');
  const stepNodes = document.querySelectorAll('.analysis-step');
  btn.disabled = true;

  // Etapas visuales (ajusta el texto si tu HTML cambia)
  const steps = [
    "Connecting to Shopify",
    "Analyzing product catalog",
    "Analyzing customer segments",
    "Generating recommendations"
  ];

  // Porcentaje (aprox) en que cada etapa se "activa"
  const stepPercents = [0, 25, 55, 80, 100];

  let progress = 0;
  let running = true;
  let currentStep = 0;

  // Actualiza la UI de los steps
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
    progressText.textContent = steps[currentStep] || "Finishing up...";
  }

  // Barra animada + steps animados
  function animateProgress() {
    if (!running) return;
    if (progress < 90) {
      progress += Math.random() * 2 + 1;
      if (progress > 90) progress = 90;
      progressBar.style.width = `${progress}%`;

      // Determina si se debe pasar al siguiente step
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

  // Inicia animaciones
  progressBar.style.width = "0%";
  updateStepsUI();
  animateProgress();

  try {
    const res = await fetch('/api/audit/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop, accessToken })
    });
    const data = await res.json();

    // Finaliza: barra llena y steps todos completados
    running = false;
    progress = 100;
    progressBar.style.width = "100%";
    currentStep = steps.length - 1;
    updateStepsUI();
    progressText.textContent = "¡Análisis completado!";
    btn.disabled = false;
    sessionStorage.setItem('auditResult', JSON.stringify(data.resultado));
  } catch (err) {
    running = false;
    progressBar.style.background = "#f55";
    progressText.textContent = "Ocurrió un error. Intenta de nuevo.";
    alert('Ocurrió un error al analizar tu tienda.');
  }
});
// Listener para avanzar al step 4 (Onboarding final)
document.getElementById('continue-btn-3')?.addEventListener('click', () => {
  window.location.href = '/onboarding4.html';
});

