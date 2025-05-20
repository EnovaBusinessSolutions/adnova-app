
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  if (page === 'login') initLogin();
});

function initLogin() {
  const form = document.querySelector('form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    submitBtn.innerText = 'Procesando...';
    submitBtn.disabled = true;

    try {
      const response = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userEmail', email);
        const done = localStorage.getItem('onboardingCompletado');
        if (done === 'true') {
          window.location.href = 'dashboard.html';
        } else {
          window.location.href = 'onboarding.html';
        }
      } else {
        alert('❌ ' + data.message);
      }
    } catch (err) {
      alert('❌ Error de conexión con el servidor');
      console.error(err);
    } finally {
      submitBtn.innerText = originalText;
      submitBtn.disabled = false;
    }
  });
}
