// public/js/recover.js
document.addEventListener('DOMContentLoaded', () => {
  const form   = document.querySelector('#recoverForm');
  const emailI = document.querySelector('#email');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailI.value.trim();
    if (!email) {
      alert('Ingresa tu correo.');
      return;
    }

    try {
      await fetch('/api/forgot-password', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ email })
      });

    
      alert('Si el correo existe en nuestra base, recibirás un enlace de recuperación.');
      form.reset();
    } catch (err) {
      console.error(err);
      alert('Error de red. Intenta más tarde.');
    }
  });
});
