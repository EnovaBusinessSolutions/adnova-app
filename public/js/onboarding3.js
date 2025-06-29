document.addEventListener("DOMContentLoaded", async () => {
  // Obtén shop y accessToken (de donde los guardes; aquí simulado)
  const shop = sessionStorage.getItem('shop');
  const accessToken = sessionStorage.getItem('accessToken');
  const btn = document.getElementById('continue-btn-3');
  btn.disabled = true;

  // Lanza la auditoría
  const { jobId } = await fetch('/api/audit/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, accessToken })
  }).then(res => res.json());

  // Polling
  let interval = setInterval(async () => {
    const data = await fetch(`/api/audit/progress/${jobId}`).then(res => res.json());
    // Aquí puedes actualizar la barra/progreso visual si lo deseas

    if (data.finished) {
      clearInterval(interval);
      btn.disabled = false;
      // Guarda resultados si lo necesitas
      sessionStorage.setItem('auditResult', JSON.stringify(data.result));
    }
  }, 2000);
});
