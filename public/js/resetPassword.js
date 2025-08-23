document.addEventListener('DOMContentLoaded', () => {
  const url   = new URL(location.href);
  const token = url.searchParams.get('token');          
  if (!token) {
    alert('Enlace inválido o incompleto');
    location.href = '/login';
    return;
  }

  const form = document.querySelector('#resetForm');
  const pwd1 = document.querySelector('#new-password');
  const pwd2 = document.querySelector('#confirm-password');
  
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const inputId = btn.getAttribute('data-input');    
      const input   = document.getElementById(inputId);
      if (!input) return;

      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';         
      btn.classList.toggle('show', show);               
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();

    if (pwd1.value !== pwd2.value) {
      alert('Las contraseñas no coinciden');
      return;
    }

    try {
      const res  = await fetch('/api/reset-password', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ token, password: pwd1.value })
      });
      const json = await res.json();

      if (json.success) {
        alert('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
        location.href = '/login';
      } else {
        alert(json.message || 'El enlace ya expiró o es inválido');
      }
    } catch (err) {
      console.error(err);
      alert('Error de red. Intenta más tarde.');
    }
  });
});