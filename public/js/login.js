// public/js/login.js

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.innerText;
    submitButton.innerText = 'Procesando...';
    submitButton.disabled = true;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.success) {
        await waitForSessionAndRedirect();
      } else {
        alert(data.message || 'Credenciales incorrectas');
      }
    } catch (err) {
      console.error('Login error:', err);
      alert('❌ Error al conectar con el servidor');
    } finally {
      submitButton.innerText = originalText;
      submitButton.disabled = false;
    }
  });

  async function waitForSessionAndRedirect() {
    let attempts = 0;
    let user = null;
    while (attempts < 5) {
      try {
        const resUser = await fetch('/api/session');
        if (resUser.ok) {
          const sessionData = await resUser.json();
          if (sessionData.authenticated) {
            user = sessionData.user;
            break;
          }
        }
      } catch (err) {
        console.warn("Esperando a que la sesión esté disponible...");
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      attempts++;
    }
    if (user) {
      const redirectUrl = user.onboardingComplete ? '/dashboard' : '/onboarding';
      window.location.href = redirectUrl;
    } else {
      alert("⚠️ No se pudo establecer sesión. Intenta iniciar sesión de nuevo.");
    }
  }
});
const registerBtn = document.getElementById('register-btn');
if (registerBtn) {
  registerBtn.addEventListener('click', () => {
    window.location.href = 'register.html';
  });
}

const googleBtn = document.getElementById('google-btn');
if (googleBtn) {
  googleBtn.addEventListener('click', () => {
    window.location.href = '/auth/google/login';
  });
}
